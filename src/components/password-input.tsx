"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> & {
  id?: string;
  label: string;
};

export function PasswordField({ id, label, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="password-field">
        <label htmlFor={inputId}>{label}</label>
        <span className="password-input-wrap">
          <input {...props} id={inputId} type={visible ? "text" : "password"} />
          <button
            className="password-visibility-toggle"
            type="button"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            <span aria-hidden="true">{visible ? "Hide" : "Show"}</span>
          </button>
        </span>
    </div>
  );
}
