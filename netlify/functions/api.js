// Membungkus aplikasi Express yang sama persis (server.js) supaya bisa
// berjalan sebagai Netlify Function. Tidak ada logic bisnis yang diduplikasi
// di sini - ini murni adaptor.
const serverless = require("serverless-http");
const app = require("../../server");

exports.handler = serverless(app);
