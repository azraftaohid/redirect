import React, { Suspense, lazy } from "react";
import { Router, Switch, Route } from "wouter";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { AccessExpiredBanner } from "@/components/AccessExpiredBanner";
import { Layout } from "@/components/Layout";
import { DashboardPage } from "@/pages/DashboardPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

const LinkStatsPage = lazy(() =>
  import("@/pages/LinkStatsPage").then((m) => ({ default: m.LinkStatsPage }))
);
const ShareTargetPage = lazy(() =>
  import("@/pages/ShareTargetPage").then((m) => ({ default: m.ShareTargetPage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Toaster richColors position="top-right" closeButton />
      <AccessExpiredBanner />
      <AuthGate>
        <Router base="/app">
          <Layout>
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-20 text-xs text-zinc-400 font-mono">
                  Loading...
                </div>
              }
            >
              <Switch>
                <Route path="/" component={DashboardPage} />
                <Route path="/links/:id" component={LinkStatsPage} />
                <Route path="/share" component={ShareTargetPage} />
                <Route path="/settings" component={SettingsPage} />
                <Route component={NotFoundPage} />
              </Switch>
            </Suspense>
          </Layout>
        </Router>
      </AuthGate>
    </AuthProvider>
  );
}

export default App;
