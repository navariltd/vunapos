import { useEffect, useId, useRef, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { unwrapVunaResponse } from "../../services/vunaApi";
import { stockMethods } from "./types";

export type InspectionContext = {
  pos_profile: string;
  stock_entry: string;
  receipt: string;
  row_name: string;
};

export function InspectionParameterCell({
  context,
  value,
  canCreate,
  excluded,
  disabled,
  autoFocus,
  onChange,
  method = stockMethods.inspectionParameters,
  label = "Parameter",
  selectOnly = false,
}: {
  context: InspectionContext;
  value: string;
  canCreate: boolean;
  excluded: string[];
  disabled: boolean;
  autoFocus: boolean;
  onChange: (name: string, create: boolean) => void;
  method?: string;
  label?: string;
  selectOnly?: boolean;
}) {
  const { call } = useFrappePostCall(method);
  const [search, setSearch] = useState(value);
  const query = selectOnly ? search : value;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<Array<{ name: string }>>([]);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 240 });
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const { pos_profile, stock_entry, receipt, row_name } = context;
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void call({ pos_profile, stock_entry, receipt, row_name, query })
        .then((response) => {
          if (!cancelled)
            setOptions(unwrapVunaResponse<Array<{ name: string }>>(response));
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setOptions([]);
            setError(
              cause instanceof Error
                ? cause.message
                : "Unable to find matching records."
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    call,
    open,
    disabled,
    query,
    pos_profile,
    stock_entry,
    receipt,
    row_name,
  ]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = input.current?.getBoundingClientRect();
      if (rect)
        setPosition({
          top:
            rect.bottom + 220 < window.innerHeight
              ? rect.bottom + 4
              : Math.max(8, rect.top - 220),
          left: Math.max(
            8,
            Math.min(
              rect.left,
              window.innerWidth - Math.max(240, rect.width) - 8
            )
          ),
          width: Math.max(240, rect.width),
        });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);
  const choices = options.filter((option) => !excluded.includes(option.name));
  const create =
    canCreate &&
    Boolean(value.trim()) &&
    !excluded.includes(value.trim()) &&
    !options.some((option) => option.name === value.trim());
  const choose = (index: number) => {
    if (index < choices.length) {
      if (selectOnly) setSearch(choices[index].name);
      onChange(choices[index].name, false);
    } else if (create) onChange(value.trim(), true);
    setOpen(false);
  };
  return (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          if (selectOnly) setSearch(value);
        }
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={
          open && active < choices.length + Number(create)
            ? `${id}-${active}`
            : undefined
        }
        className="h-9 w-full rounded border border-outline-variant bg-surface px-2 text-sm font-normal"
        placeholder={label}
        maxLength={140}
        value={query}
        disabled={disabled}
        onFocus={() => {
          if (selectOnly) setSearch(value);
          setOpen(true);
        }}
        onChange={(event) => {
          if (selectOnly) setSearch(event.target.value);
          else onChange(event.target.value, false);
          setOptions([]);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              Math.max(
                0,
                Math.min(
                  choices.length + Number(create) - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1)
                )
              )
            );
          }
          if (
            event.key === "Enter" &&
            open &&
            choices.length + Number(create) > 0
          ) {
            event.preventDefault();
            choose(Math.min(active, choices.length + Number(create) - 1));
          }
        }}
      />
      {open ? (
        <div
          className="fixed z-[90] max-h-52 overflow-y-auto rounded-md border border-outline-variant bg-surface p-1 font-normal shadow-lg"
          style={position}
        >
          {loading ? (
            <p className="p-2 text-xs" role="status">
              Searching…
            </p>
          ) : null}
          {error ? (
            <p className="p-2 text-xs text-error" role="alert">
              {error}
            </p>
          ) : null}
          <div id={id} role="listbox" aria-label={label}>
            {choices.map((option, index) => (
              <button
                key={option.name}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={active === index}
                className={`block w-full cursor-pointer rounded px-2 py-2 text-left text-sm hover:bg-surface-container ${
                  active === index ? "bg-surface-container" : ""
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                {option.name}
              </button>
            ))}
            {create ? (
              <button
                id={`${id}-${choices.length}`}
                type="button"
                role="option"
                aria-selected={active === choices.length}
                className="block w-full cursor-pointer border-t border-outline-variant px-2 py-2 text-left text-sm font-medium hover:bg-surface-container"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(choices.length)}
              >
                Create new parameter: {value.trim()}
              </button>
            ) : null}
          </div>
          {!loading && !error && !choices.length && !create ? (
            <p className="p-2 text-xs text-on-surface-variant">No matches.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
