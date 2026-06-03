// GET /api/health/live — apenas verifica se o processo está vivo
module.exports = (req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
};
