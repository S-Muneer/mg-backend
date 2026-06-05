const jwt = require("jsonwebtoken");
const { jwtSecret } = require("../config");

function signToken(payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: "7d" });
}

function getTokenFromHeader(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function authenticate(required = true) {
  return (req, res, next) => {
    const token = getTokenFromHeader(req.headers.authorization);
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ message: "Unauthorized" });
    }

    try {
      req.auth = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.auth || req.auth.role !== role) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

module.exports = {
  signToken,
  authenticate,
  requireRole,
};
