import { digitsFromInput } from "../utils/fileNumber";

// The file number box: the visit-type prefix and financial-year suffix are fixed and can't be
// edited, so the only thing typed is the number itself — "IPD-" [ 13531 ] "/26-27".
// `value` holds just the digits; build the full string with buildFileNumber() on submit.
export default function FileNumberInput({ visitType, value, onChange, fy, autoFocus, required, disabled }) {
  const blocked = disabled || !visitType;
  return (
    <div className={`file-number-input${blocked ? " is-disabled" : ""}`}>
      <span className="fn-affix">{visitType ? `${visitType}-` : "—"}</span>
      <input
        value={value}
        onChange={(e) => onChange(digitsFromInput(e.target.value))}
        inputMode="numeric"
        autoComplete="off"
        placeholder={visitType ? "13531" : "pick visit type"}
        autoFocus={autoFocus}
        required={required}
        disabled={blocked}
        aria-label={`${visitType || ""} file number`}
      />
      <span className="fn-affix">/{fy}</span>
    </div>
  );
}
