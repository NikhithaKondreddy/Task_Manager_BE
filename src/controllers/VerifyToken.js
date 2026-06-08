var jwt = require("jsonwebtoken"); // used to create, sign, and verify tokens
require("dotenv").config();
const env = require('../config/env');


function verifyToken(req, res, next) {
  var token = req.headers["x-access-token"];
  if (!token)
    return res.status(403).send({ auth: false, message: "No token provided." });

  jwt.verify(token, env.JWT_SECRET || env.SECRET || 'secret', function (err, decoded) {
    if (err)
      return res
        .status(500)
        .send({ auth: false, message: "Failed to authenticate token." });

    req.loginId = decoded.id;

    next();
  });
}

module.exports = verifyToken;
