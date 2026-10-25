import React from "react";
import { Router, Switch, Route } from "wouter";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGate } from "@/components/AuthGate";
import { AccessExpiredBanner } from "@/components/AccessExpiredBanner";
import { Layout } from "@/components/Layout";
import { DashboardPage } from "@/pages/DashboardPage";
import { LinkStatsPage } from "@/pages/LinkStatsPage";
import { ShareTargetPage } from "@/pages/ShareTargetPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Toaster richColors position="top-right" closeButton />
      <AccessExpiredBanner />
      <AuthGate>
        <Router base="/app">
          <Layout>
            <Switch>
              <Route path="/" component={DashboardPage} />
              <Route path="/links/:id" component={LinkStatsPage} />
              <Route path="/share" component={ShareTargetPage} />
              <Route path="/settings" component={SettingsPage} />
              <Route component={NotFoundPage} />
            </Switch>
          </Layout>
        </Router>
      </AuthGate>
    </AuthProvider>
  );
}

export default App;
