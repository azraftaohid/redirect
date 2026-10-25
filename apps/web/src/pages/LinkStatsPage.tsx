import React from "react";
import { useParams } from "wouter";

export function LinkStatsPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Link Statistics: {id}</h1>
    </div>
  );
}
