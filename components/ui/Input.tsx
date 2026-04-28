import { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  error?: string;
}

export function Input({ label, error, className = "", ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <input
        {...props}
        className={`
          w-full rounded-xl border px-4 py-3 text-sm
          bg-white text-gray-900 placeholder-gray-400
          border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100
          outline-none transition-colors
          disabled:opacity-50
          ${error ? "border-red-400 focus:border-red-400 focus:ring-red-100" : ""}
          ${className}
        `}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className = "",
  ...props
}: TextareaProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <textarea
        {...props}
        className={`
          w-full rounded-xl border px-4 py-3 text-sm
          bg-white text-gray-900 placeholder-gray-400
          border-gray-300 focus:border-orange-400 focus:ring-2 focus:ring-orange-100
          outline-none transition-colors resize-none
          disabled:opacity-50
          ${error ? "border-red-400 focus:border-red-400 focus:ring-red-100" : ""}
          ${className}
        `}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
