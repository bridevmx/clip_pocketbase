/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // ─── spei_banks seed data ───────────────────────────────────────────────
  // Complete catalog of Mexican banks for SPEI transfers.
  // Source: Banxico — https://www.banxico.org.mx/

  const banks = [
    { bank_code: "40133", bank_name: "ACTINVER" },
    { bank_code: "40062", bank_name: "AFIRME" },
    { bank_code: "90721", bank_name: "ALBO" },
    { bank_code: "90706", bank_name: "ARCUS FI" },
    { bank_code: "90659", bank_name: "ASP INTEGRA OPC" },
    { bank_code: "40127", bank_name: "AZTECA" },
    { bank_code: "37166", bank_name: "BABien" },
    { bank_code: "40030", bank_name: "BAJIO" },
    { bank_code: "40002", bank_name: "BANAMEX" },
    { bank_code: "40154", bank_name: "BANCO COVALTO" },
    { bank_code: "37006", bank_name: "BANCOMEXT" },
    { bank_code: "40137", bank_name: "BANCOPPEL" },
    { bank_code: "40160", bank_name: "BANCO S3" },
    { bank_code: "40152", bank_name: "BANCREA" },
    { bank_code: "37019", bank_name: "BANJERCITO" },
    { bank_code: "40147", bank_name: "BANKAOOL" },
    { bank_code: "40106", bank_name: "BANK OF AMERICA" },
    { bank_code: "40159", bank_name: "BANK OF CHINA" },
    { bank_code: "37009", bank_name: "BANOBRAS" },
    { bank_code: "40072", bank_name: "BANORTE" },
    { bank_code: "40058", bank_name: "BANREGIO" },
    { bank_code: "40060", bank_name: "BANSI" },
    { bank_code: "2001",  bank_name: "BANXICO" },
    { bank_code: "40129", bank_name: "BARCLAYS" },
    { bank_code: "40145", bank_name: "BBASE" },
    { bank_code: "40012", bank_name: "BBVA MEXICO" },
    { bank_code: "40112", bank_name: "BMONEX" },
    { bank_code: "90677", bank_name: "CAJA POP MEXICA" },
    { bank_code: "90683", bank_name: "CAJA TELEFONIST" },
    { bank_code: "90715", bank_name: "CASHI CUENTA" },
    { bank_code: "90631", bank_name: "CI BOLSA" },
    { bank_code: "40124", bank_name: "CITI MEXICO" },
    { bank_code: "90730", bank_name: "CLIP" },
    { bank_code: "90901", bank_name: "CLS" },
    { bank_code: "90903", bank_name: "CODI VALIDA" },
    { bank_code: "40130", bank_name: "COMPARTAMOS" },
    { bank_code: "40140", bank_name: "CONSUBANCO" },
    { bank_code: "90725", bank_name: "COOPDESARROLLO" },
    { bank_code: "90652", bank_name: "CREDICAPITAL" },
    { bank_code: "90688", bank_name: "CREDICLUB" },
    { bank_code: "90680", bank_name: "CRISTOBAL COLON" },
    { bank_code: "90723", bank_name: "CUENCA" },
    { bank_code: "90729", bank_name: "DEP Y PAG DIG" },
    { bank_code: "40151", bank_name: "DONDE" },
    { bank_code: "90616", bank_name: "FINAMEX" },
    { bank_code: "90634", bank_name: "FINCOMUN" },
    { bank_code: "90734", bank_name: "FINCO PAY" },
    { bank_code: "90738", bank_name: "FINTOC" },
    { bank_code: "90699", bank_name: "FONDEADORA" },
    { bank_code: "90685", bank_name: "FONDO (FIRA)" },
    { bank_code: "90601", bank_name: "GBM" },
    { bank_code: "40167", bank_name: "HEY BANCO" },
    { bank_code: "37168", bank_name: "HIPOTECARIA FED" },
    { bank_code: "40021", bank_name: "HSBC" },
    { bank_code: "40155", bank_name: "ICBC" },
    { bank_code: "40036", bank_name: "INBURSA" },
    { bank_code: "90902", bank_name: "INDEVAL" },
    { bank_code: "40150", bank_name: "INMOBILIARIO" },
    { bank_code: "40136", bank_name: "INTERCAM BANCO" },
    { bank_code: "40059", bank_name: "INVEX" },
    { bank_code: "40110", bank_name: "JP MORGAN" },
    { bank_code: "40128", bank_name: "KAPITAL" },
    { bank_code: "90661", bank_name: "KLAR" },
    { bank_code: "90653", bank_name: "KUSPIT" },
    { bank_code: "90670", bank_name: "LIBERTAD" },
    { bank_code: "90602", bank_name: "MASARI" },
    { bank_code: "90722", bank_name: "MERCADO PAGO W" },
    { bank_code: "90720", bank_name: "MEXPAGO" },
    { bank_code: "40042", bank_name: "MIFEL" },
    { bank_code: "40158", bank_name: "MIZUHO BANK" },
    { bank_code: "90600", bank_name: "MONEXCB" },
    { bank_code: "40108", bank_name: "MUFG" },
    { bank_code: "40132", bank_name: "MULTIVA BANCO" },
    { bank_code: "37135", bank_name: "NAFIN" },
    { bank_code: "90638", bank_name: "NU MEXICO" },
    { bank_code: "90710", bank_name: "NVIO" },
    { bank_code: "40148", bank_name: "PAGATODO" },
    { bank_code: "90732", bank_name: "PEIBO" },
    { bank_code: "90714", bank_name: "PPBALANCEMX" },
    { bank_code: "90620", bank_name: "PROFUTURO" },
    { bank_code: "40156", bank_name: "SABADELL" },
    { bank_code: "40014", bank_name: "SANTANDER" },
    { bank_code: "40044", bank_name: "SCOTIABANK" },
    { bank_code: "40157", bank_name: "SHINHAN" },
    { bank_code: "90728", bank_name: "SPIN BY OXXO" },
    { bank_code: "90646", bank_name: "STP" },
    { bank_code: "90703", bank_name: "TESORED" },
    { bank_code: "90684", bank_name: "TRANSFER" },
    { bank_code: "90727", bank_name: "TRANSFER DIRECT" },
    { bank_code: "40138", bank_name: "UALA" },
    { bank_code: "90656", bank_name: "UNAGRA" },
    { bank_code: "90617", bank_name: "VALMEX" },
    { bank_code: "90605", bank_name: "VALUE" },
    { bank_code: "40113", bank_name: "VE POR MAS" },
    { bank_code: "40141", bank_name: "VOLKSWAGEN" },
  ];

  const collection = app.findCollectionByNameOrId("spei_banks");

  for (const bank of banks) {
    const record = new Record(collection);
    record.set("bank_code", bank.bank_code);
    record.set("bank_name", bank.bank_name);
    record.set("is_active", true);
    app.save(record);
  }

}, (app) => {
  // Rollback: delete all spei_banks records (collection stays).
  try {
    const collection = app.findCollectionByNameOrId("spei_banks");
    const records = app.findRecordsByFilter("spei_banks", "id != ''");
    for (const rec of records) {
      app.delete(rec);
    }
  } catch (_) {}
});
