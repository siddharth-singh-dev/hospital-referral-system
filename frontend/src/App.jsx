import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ReferralForm from "./pages/ReferralForm";
import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import ReceptionDashboard from "./pages/ReceptionDashboard";
import DoctorDashboard from "./pages/DoctorDashboard";
import MarketingPersonDashboard from "./pages/MarketingPersonDashboard";
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import StaffPortal from "./pages/StaffPortal";
import MarketingHeadPortal from "./pages/MarketingHeadPortal";
import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/refer/:doctorCode" element={<ReferralForm />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/super-admin"
          element={
            <ProtectedRoute role="SUPER_ADMIN">
              <SuperAdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="ADMIN">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reception"
          element={
            <ProtectedRoute role="RECEPTION">
              <ReceptionDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff"
          element={
            <ProtectedRoute role="STAFF">
              <StaffPortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/team"
          element={
            <ProtectedRoute role="STAFF">
              <MarketingHeadPortal />
            </ProtectedRoute>
          }
        />
        <Route path="/doctor/:doctorCode" element={<DoctorDashboard />} />
        <Route path="/marketing/:id" element={<MarketingPersonDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}
