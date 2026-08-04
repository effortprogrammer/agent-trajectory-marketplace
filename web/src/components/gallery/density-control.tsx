import { Slider } from "@higgsfield/quanta/slider";
import { DENSITY_ROW_HEIGHTS } from "./use-justified-gallery.ts";

/**
 * Tile-size control. A Quanta stepped `Slider` maps its notches to the
 * gallery's target row heights: dragging right makes tiles LARGER (fewer per
 * row), dragging left makes them smaller / denser. Changing it triggers a
 * layout recompute in the engine while scroll anchoring keeps the view stable.
 */
export interface DensityControlProps {
  value: number;
  onChange: (level: number) => void;
}

export function DensityControl({ value, onChange }: DensityControlProps) {
  const steps = DENSITY_ROW_HEIGHTS.length;
  return (
    <div className="flex items-center gap-2">
      <Slider
        aria-label="Tile density"
        steps={steps}
        value={value}
        onChange={onChange}
        className="w-32"
      />
    </div>
  );
}
