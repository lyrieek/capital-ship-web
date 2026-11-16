import type { ReactNode } from "react";
import "./Slider.css";

export interface SliderOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SliderProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SliderOption<T>[];
  ariaLabel?: string;
  className?: string;
}

export function Slider<T extends string>({ value, onChange, options, ariaLabel, className }: SliderProps<T>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div className={className ? `slider ${className}` : "slider"} role="group" aria-label={ariaLabel} aria-orientation="horizontal">
      <span
        className="slider-thumb"
        aria-hidden="true"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.ariaLabel}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
