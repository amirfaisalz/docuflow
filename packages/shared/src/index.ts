export const SERVICE_NAMES = ["api", "worker"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface HealthResponse {
  status: "ok";
  service: ServiceName;
}
