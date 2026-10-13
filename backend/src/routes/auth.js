import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../utils/prismaClient.js";

const router = express.Router();

// POST /api/auth/login  { email, password }  — for super admin, admin, reception, and
// custom-role (STAFF) staff. Doctors never use this route; their dashboard is reached
// via their unique QR link.
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.staffUser.findUnique({
    where: { email },
    include: { hospital: true, customRole: true },
  });
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const permissions = user.role === "STAFF" ? user.customRole?.permissions || [] : [];

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, hospitalId: user.hospitalId, permissions },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      hospitalName: user.hospital?.name || null,
      hospitalBranchName: user.hospital?.branchName || null,
      customRoleName: user.customRole?.name || null,
      permissions,
    },
  });
});

export default router;