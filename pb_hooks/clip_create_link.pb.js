/// <reference path="../pb_data/types.d.ts" />
// ─────────────────────────────────────────────────────────────────────────
// POST /api/clip/create-link — Creates a Clip v2 payment link.
//
// Authentication: OPTIONAL — supports both logged-in and guest (anonymous)
// checkouts. When a user is authenticated, the clip_order is linked to
// their account via the `user` field.
//
// ─── AMOUNT RESOLUTION (two modes) ───────────────────────────────────────
// SECURE MODE (recommended for production):
//   Set plugin_settings key "clip_amount_field" to the field name in your
//   reference collection that holds the canonical price (e.g. "total").
//   The endpoint then reads the amount from the DB — the client cannot
//   manipulate it. If the reference record is not found, it returns 404.
//
// LEGACY MODE (backward-compatible default):
//   If "clip_amount_field" is not configured, the amount comes from the
//   client body["amount"] field. In this mode you MUST validate the amount
//   in my_app_clip_handler.pb.js before activating any product or service.
//
// ─── Optional Clip v2 fields ──────────────────────────────────────────────
//   metadata: { me_reference_id, customer_info: { name, email, phone } }
//   billing_address: { zip_code, city, state, country, street, ... }
//   override_settings: { payment_method: ["CARD","CASH"], enable_tip: false }
// ─────────────────────────────────────────────────────────────────────────

routerAdd("POST", "/api/clip/create-link", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);
  const psh  = require(`${__hooks}/plugin_settings_helper.js`);
  const rl   = require(`${__hooks}/rate_limiter.js`);

  var rawAddr = e.request.remoteAddr || "";
  var clientIp;
  if (rawAddr.startsWith("[")) {
    // IPv6: "[::1]:port" -> "::1"
    clientIp = rawAddr.replace(/^\[/, "").split("]:")[0] || "unknown";
  } else {
    // IPv4: "1.2.3.4:port" -> "1.2.3.4"
    clientIp = rawAddr.split(":")[0] || "unknown";
  }
  var rlResult = rl.checkLimit("clip_create:" + clientIp, 20, 60 * 1000); // 20 req/min per IP
  if (!rlResult.allowed) {
    $app.logger().warn("[CLIP] Rate limit exceeded on create-link", "ip", clientIp);
    throw new ApiError(429, "Too many requests. Please try again later.");
  }

  const info = e.requestInfo();
  const body = info.body;

  const referenceCollection = body["reference_collection"];
  const referenceId         = body["reference_id"];

  // Authentication is optional — guest checkouts are allowed.
  const userId = info.auth ? info.auth.id : null;

  if (!referenceCollection || !referenceId) {
    throw new BadRequestError("reference_collection and reference_id are required");
  }

  // ─── AMOUNT RESOLUTION ───────────────────────────────────────────────────
  // SECURE MODE: when plugin_settings key "clip_amount_field" is set, the
  // amount is read from the DB — the client cannot tamper with it.
  // LEGACY MODE: if the key is empty, falls back to the client-provided
  // "amount" field (validate in my_app_clip_handler.pb.js if needed).
  let amount = null;
  let amountSource = "client";

  const amountField = psh.getSetting("clip_amount_field", "");
  var refRecord = null;

  if (amountField) {
    try {
      refRecord = $app.findRecordById(referenceCollection, referenceId);
      amount = refRecord.get(amountField);
      amountSource = "server";
    } catch (_) {
      throw new NotFoundError("Reference record not found: " + referenceCollection + "/" + referenceId);
    }
  } else if (info.auth && info.auth.id) {
    try {
      refRecord = $app.findRecordById(referenceCollection, referenceId);
    } catch (_) {
      refRecord = null;
    }
  }

  // IDOR protection: verify the authenticated user owns the reference record
  if (refRecord && info.auth && info.auth.id) {
    var recordOwner = refRecord.getString("user");
    if (recordOwner && recordOwner !== info.auth.id) {
      if (!psh.isPluginAdmin(info.auth.id)) {
        $app.logger().warn(
          "[CLIP] IDOR attempt: user tried to checkout a record they do not own",
          "user_id", info.auth.id,
          "record_owner", recordOwner,
          "collection", referenceCollection,
          "record_id", referenceId
        );
        throw new ForbiddenError("You cannot create a payment for a record you do not own");
      }
    }
  }

  if (amount === null || amount === undefined) {
    amount = body["amount"]; // legacy client-provided amount
    amountSource = "client";
  }

  if (!amount || amount <= 0 || amount > 999999) {
    throw new BadRequestError("Invalid or missing amount (source: " + amountSource + ")");
  }

  $app.logger().info("[CLIP] create-link", "amount_source", amountSource, "amount", amount);

  const webhookBaseUrl = $os.getenv("POCKETBASE_URL");

  // Create the order record before calling Clip so we always have a local
  // record even if the Clip API call fails later.
  let order;
  $app.runInTransaction((txApp) => {
    const ordersCollection = txApp.findCollectionByNameOrId("clip_orders");
    order = new Record(ordersCollection);
    if (userId) {
      order.set("user", userId);
    }
    order.set("reference_collection", referenceCollection);
    order.set("reference_id", referenceId);
    order.set("amount", amount);
    order.set("currency", "MXN");
    order.set("status", "PENDING_LINK");
    txApp.save(order);
  });

  // Build the Clip API payload.
  // Start with required fields.
  const clipPayload = {
    amount: amount,
    currency: "MXN",
    purchase_description: referenceCollection + ":" + referenceId,
    redirection_url: {
      success: webhookBaseUrl,
      error:   webhookBaseUrl,
      cancel:  webhookBaseUrl,
    },
    webhook_url: webhookBaseUrl + "/api/clip/webhook",
  };

  // ─── metadata (optional) ──────────────────────────────────────────────
  // Passes through customer_info and me_reference_id to Clip.
  const metadata = body["metadata"];
  if (metadata && typeof metadata === "object") {
    clipPayload.metadata = {};

    if (metadata["me_reference_id"]) {
      clipPayload.metadata.me_reference_id = String(metadata["me_reference_id"]);
    }

    const customerInfo = metadata["customer_info"];
    if (customerInfo && typeof customerInfo === "object") {
      clipPayload.metadata.customer_info = {};
      if (customerInfo["name"])  clipPayload.metadata.customer_info.name  = String(customerInfo["name"]);
      if (customerInfo["email"]) clipPayload.metadata.customer_info.email = String(customerInfo["email"]);
      if (customerInfo["phone"]) clipPayload.metadata.customer_info.phone = String(customerInfo["phone"]);
    }
  }

  // ─── billing_address (optional) ───────────────────────────────────────
  const billing = body["billing_address"];
  if (billing && typeof billing === "object") {
    clipPayload.billing_address = {};
    const billingFields = [
      "zip_code", "locality", "city", "state", "country",
      "street", "outdoor_number", "interior_number",
      "reference", "between_streets", "floor",
    ];
    for (let i = 0; i < billingFields.length; i++) {
      const field = billingFields[i];
      if (billing[field]) clipPayload.billing_address[field] = String(billing[field]);
    }
  }

  // ─── override_settings (optional) ─────────────────────────────────────
  // Controls which payment methods are shown and whether tipping is enabled.
  const override = body["override_settings"];
  if (override && typeof override === "object") {
    clipPayload.override_settings = {};

    if (Array.isArray(override["payment_method"])) {
      clipPayload.override_settings.payment_method = override["payment_method"];
    }
    if (typeof override["enable_tip"] === "boolean") {
      clipPayload.override_settings.enable_tip = override["enable_tip"];
    }
    if (override["currency"] && typeof override["currency"] === "object") {
      clipPayload.override_settings.currency = {};
      if (typeof override["currency"]["show_currency_code"] === "boolean") {
        clipPayload.override_settings.currency.show_currency_code = override["currency"]["show_currency_code"];
      }
    }
  }

  // Call the Clip API to create the payment link.
  let clipResult;
  try {
    clipResult = clip.request("POST", "/v2/checkout", clipPayload, 20);
  } catch (err) {
    $app.logger().error("Error calling Clip API", "error", err.message);
    order.set("status", "ERROR_CLIP");
    $app.save(order);
    throw new InternalServerError("Could not create Clip payment link");
  }

  if (clipResult.statusCode < 200 || clipResult.statusCode > 299) {
    const errBody = clipResult.data || {};
    $app.logger().error(
      "Clip API rejected create-link",
      "status", clipResult.statusCode,
      "code_message", errBody["code_message"] || "",
      "detail", errBody["detail"] || ""
    );
    order.set("status", "ERROR_CLIP");
    $app.save(order);
    throw new InternalServerError("Could not create Clip payment link");
  }

  const clipData = clipResult.data;

  // Persist the Clip identifiers returned in the response.
  const paymentUrl = clipData["payment_request_url"] || clipData["payment_url"] || "";
  order.set("clip_payment_request_id", clipData["payment_request_id"]);
  order.set("clip_payment_url", paymentUrl);
  order.set("status", "CREATED");
  $app.save(order);

  $app.logger().info(
    "Clip payment link created",
    "order_id", order.id,
    "payment_request_id", clipData["payment_request_id"],
    "payment_url", paymentUrl
  );

  return e.json(200, {
    order_id: order.id,
    payment_url: paymentUrl,
    payment_request_id: clipData["payment_request_id"],
    status: "CREATED",
  });
});
