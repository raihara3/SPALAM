export interface Feature {
  x: number;
  y: number;
  trackingCount: number; // 追跡されているフレーム数
  id?: string;
}
