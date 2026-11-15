export interface ReadinessDependency {
  name: string;
  check(): Promise<unknown>;
}

export interface ReadinessReport {
  status: "ok" | "error";
  checks: Record<string, "up" | "down">;
}

export async function createReadinessReport(dependencies: ReadinessDependency[]): Promise<ReadinessReport> {
  const results = await Promise.all(
    dependencies.map(async ({ name, check }) => {
      try {
        await check();
        return [name, "up"] as const;
      } catch {
        return [name, "down"] as const;
      }
    }),
  );
  const checks = Object.fromEntries(results);
  return { status: results.every(([, result]) => result === "up") ? "ok" : "error", checks };
}
