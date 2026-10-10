import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";

const ROUTES = { SUPER_ADMIN: "/super-admin", ADMIN: "/admin", RECEPTION: "/reception", STAFF: "/staff" };

// A staff account whose role is *only* "view my marketing team" (a team head) lands on the team
// dashboard; anyone with referral permissions too still lands on the referrals portal.
function landingPath(user) {
  if (user.role === "STAFF") {
    const perms = user.permissions || [];
    if (perms.includes("VIEW_MY_MARKETING_TEAM") && perms.every((p) => p === "VIEW_MY_MARKETING_TEAM")) return "/team";
  }
  return ROUTES[user.role] || "/login";
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate(landingPath(data.user));
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 80 }}>
      <div className="card">
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <img src="/logo.png" alt="Vedansh Medicare" style={{ height: 52, marginBottom: 8 }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--teal-600)", letterSpacing: "0.03em", textTransform: "uppercase" }}>Referral Platform</div>
        </div>
        <h2>Staff login</h2>
        <p style={{ color: "#667085", fontSize: 14, marginTop: -8 }}>
          For hospital admin and reception staff. Doctors use their personal QR link instead.
        </p>
        <form onSubmit={handleSubmit}>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    </div>
  );
}
