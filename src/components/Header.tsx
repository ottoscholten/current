import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const Header = () => {
  const { signOut } = useAuth();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Current</h1>
          <p className="text-xs text-muted-foreground">Discover life weekly</p>
        </div>
        <nav className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeClassName="bg-secondary text-foreground font-medium"
          >
            This Week
          </NavLink>
          <NavLink
            to="/sources"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeClassName="bg-secondary text-foreground font-medium"
          >
            Sources
          </NavLink>
          <NavLink
            to="/profile"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            activeClassName="bg-secondary text-foreground font-medium"
          >
            Profile
          </NavLink>
          <Button variant="ghost" size="sm" onClick={signOut} className="ml-2 text-muted-foreground">
            Sign out
          </Button>
        </nav>
      </div>
    </header>
  );
};

export default Header;
