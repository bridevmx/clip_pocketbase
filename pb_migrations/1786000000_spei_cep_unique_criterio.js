/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("cep_verifications");

  // Add missing fields to cep_verifications if not present
  if (!collection.fields.getByName("criterio")) {
    collection.fields.add(new TextField({ name: "criterio", max: 30 }));
  }
  if (!collection.fields.getByName("emisor")) {
    collection.fields.add(new TextField({ name: "emisor", max: 10 }));
  }
  if (!collection.fields.getByName("monto_declarado")) {
    collection.fields.add(new TextField({ name: "monto_declarado", max: 20 }));
  }

  app.save(collection);

  // Add conditional UNIQUE index to prevent race condition double-spend on LIQUIDADO criterio
  app.db().newQuery(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_cep_unique_settled_criterio ON cep_verifications (criterio) WHERE status_name = 'LIQUIDADO'"
  ).execute();
}, (app) => {
  try {
    app.db().newQuery("DROP INDEX IF EXISTS idx_cep_unique_settled_criterio").execute();
  } catch (_) {}

  try {
    const collection = app.findCollectionByNameOrId("cep_verifications");
    const fieldsToRemove = ["criterio", "emisor", "monto_declarado"];
    for (let i = 0; i < fieldsToRemove.length; i++) {
      const field = collection.fields.getByName(fieldsToRemove[i]);
      if (field) {
        collection.fields.removeById(field.id);
      }
    }
    app.save(collection);
  } catch (_) {}
});
