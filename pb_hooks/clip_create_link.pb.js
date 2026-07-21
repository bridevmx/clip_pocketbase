/// <reference path="../pb_data/types.d.ts" />
// Endpoint to create a Clip payment link from PocketBase.
// Authentication is optional: if a user is logged in, the order is linked
// to their account; anonymous (guest) checkouts are also supported.

routerAdd("POST", "/api/clip/create-link", (e) => {
  const clip = require(`${__hooks}/clip_api_client.js`);

  const info = e.requestInfo();
  const body = info.body;

  const amount = body["amount"];
  const referenceCollection = body["reference_collection"];
  const referenceId = body["reference_id"];

  // Authentication is optional — guest checkouts are allowed.
  const userId = info.auth ? info.auth.id : null;

  if (!amount || !referenceCollection || !referenceId) {
    throw new BadRequestError("amount, reference_collection and reference_id are required");
  }
  if (amount <= 0 || amount > 99999) {
    throw new BadRequestError("Invalid amount");
  }

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

  // Call the Clip API to create the payment link.
  let clipResult;
  try {
    clipResult = clip.request(
      "POST",
      "/v2/checkout",
      {
        amount: amount,
        currency: "MXN",
        purchase_description: referenceCollection + ":" + referenceId,
        redirection_url: {
          success: webhookBaseUrl,
          error:   webhookBaseUrl,
          cancel:  webhookBaseUrl,
        },
        webhook_url: webhookBaseUrl + "/api/clip/webhook",
      },
      20
    );
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
  // v2 returns payment_request_url (not payment_url).
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
