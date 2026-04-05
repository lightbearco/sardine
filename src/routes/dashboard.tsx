import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dashboard")({
	component: DashboardLayoutRoute,
});

function DashboardLayoutRoute() {
	return <Outlet />;
}
