import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const ProtectedRoute = () => {
  const { session, isLoading } = useAuth();

  if (isLoading) return (
    <div className="flex min-h-screen items-center justify-center">
      <span className="text-sm text-muted-foreground">Loading…</span>
    </div>
  );
  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
};

export default ProtectedRoute;
