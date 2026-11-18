import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { Inspection } from "./QualityInspectionDialog";
import {
  InspectionParameterCell,
  type InspectionContext,
} from "./InspectionParameterCell";

type Reading = Inspection["readings"][number];
const cellInput =
  "h-9 w-full min-w-0 rounded border border-outline-variant bg-surface px-2 text-sm disabled:opacity-70";

export function InspectionReadingsTable({
  readings,
  disabled,
  onChange,
  onRemove,
  context,
  canCreate = false,
}: {
  readings: Reading[];
  disabled: boolean;
  onChange: (index: number, change: Partial<Reading>) => void;
  onRemove: (index: number) => void;
  context?: InspectionContext;
  canCreate?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const readingInput = (row: Reading, index: number, number: number) => (
    <input
      aria-label={`${row.specification}: Reading ${number + 1}`}
      className={cellInput}
      disabled={disabled}
      value={row.values[number] || ""}
      onChange={(event) =>
        onChange(index, {
          values: row.values.map((value, i) =>
            i === number ? event.target.value : value
          ),
          status: "Rejected",
        })
      }
    />
  );
  const limitInput = (
    row: Reading,
    index: number,
    field: "min_value" | "max_value"
  ) =>
    row.additional && !disabled ? (
      <input
        aria-label={`${row.specification}: ${
          field === "min_value" ? "Minimum" : "Maximum"
        } value`}
        type="number"
        step="any"
        className={cellInput}
        value={Number.isFinite(row[field]) ? row[field] : ""}
        onChange={(event) =>
          onChange(index, {
            [field]:
              event.target.value === "" ? NaN : Number(event.target.value),
            status: "Rejected",
          })
        }
      />
    ) : (
      <span className="tabular-nums">{row[field]}</span>
    );
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded border border-outline-variant">
        <table
          className="w-full min-w-[1100px] table-fixed text-left text-sm"
          aria-label="Inspection parameters"
        >
          <thead className="bg-surface-container-low text-xs text-on-surface-variant">
            <tr>
              <th scope="col" className="w-10 p-3">
                #
              </th>
              <th scope="col" className="w-[20%] p-3">
                Parameter
              </th>
              <th scope="col" className="w-20 p-3">
                Numeric
              </th>
              <th scope="col" className="w-[9%] p-3">
                Min value
              </th>
              <th scope="col" className="w-[9%] p-3">
                Max value
              </th>
              <th scope="col" className="w-[15%] p-3">
                Reading Value
              </th>
              <th scope="col" className="w-[15%] p-3">
                Reading 1
              </th>
              <th scope="col" className="w-[14%] p-3">
                Status
              </th>
              <th scope="col" className="w-24 p-3">
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {!readings.length ? (
              <tr>
                <td colSpan={9} className="p-4 text-on-surface-variant">
                  No parameters added. Use Add row to record individual checks.
                </td>
              </tr>
            ) : null}
            {readings.map((row, index) => {
              const key =
                row.name ||
                row.client_id ||
                row.specification ||
                `row-${index}`;
              const open = expanded === key;
              const editable = Boolean(row.additional && !disabled);
              const range = Boolean(row.numeric && !row.formula_based_criteria);
              return (
                <Fragment key={key}>
                  <tr className="border-t border-outline-variant hover:bg-surface-container-low">
                    <td className="p-3 text-on-surface-variant">{index + 1}</td>
                    <th scope="row" className="break-words p-2 font-medium">
                      {row.additional && context ? (
                        <InspectionParameterCell
                          context={context}
                          value={row.specification}
                          canCreate={canCreate}
                          excluded={readings
                            .filter((_, i) => i !== index)
                            .map((part) => part.specification)}
                          disabled={disabled}
                          autoFocus={Boolean(
                            row.client_id &&
                              index === readings.length - 1 &&
                              !row.specification
                          )}
                          onChange={(specification, create_parameter) =>
                            onChange(index, {
                              specification,
                              create_parameter,
                              status: "Rejected",
                            })
                          }
                        />
                      ) : (
                        row.specification
                      )}
                    </th>
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`${row.specification}: Numeric`}
                        checked={Boolean(row.numeric)}
                        disabled={!editable}
                        onChange={(event) =>
                          onChange(index, {
                            numeric: event.target.checked ? 1 : 0,
                            status: "Rejected",
                          })
                        }
                      />
                    </td>
                    <td className="p-2">
                      {range ? limitInput(row, index, "min_value") : "—"}
                    </td>
                    <td className="p-2">
                      {range ? limitInput(row, index, "max_value") : "—"}
                    </td>
                    <td className="p-2">
                      {!row.numeric ? (
                        <input
                          aria-label={`${row.specification}: Reading Value`}
                          className={cellInput}
                          disabled={disabled}
                          value={row.reading_value || ""}
                          onChange={(event) =>
                            onChange(index, {
                              reading_value: event.target.value,
                              status: "Rejected",
                            })
                          }
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2">
                      {row.numeric ? readingInput(row, index, 0) : "—"}
                    </td>
                    <td className="p-2">
                      <select
                        aria-label={`${row.specification}: Status`}
                        className={cellInput}
                        disabled={disabled}
                        value={row.status || "Rejected"}
                        onChange={(event) =>
                          onChange(index, { status: event.target.value })
                        }
                      >
                        <option value="Accepted">Accepted</option>
                        <option value="Rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          aria-expanded={open}
                          aria-controls={`inspection-readings-${index}`}
                          aria-label={`${row.specification}: ${
                            open ? "Hide" : "More"
                          } readings and criteria`}
                          onClick={() => setExpanded(open ? null : key)}
                        >
                          {open ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
                        </Button>
                        {editable ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-2 text-error"
                            aria-label={`Remove added check: ${row.specification}`}
                            onClick={() => onRemove(index)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {open ? (
                    <tr
                      id={`inspection-readings-${index}`}
                      className="border-t border-outline-variant bg-surface-container-low"
                    >
                      <td colSpan={9} className="space-y-3 p-4">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={Boolean(row.manual_inspection)}
                            disabled={!editable}
                            onChange={(event) =>
                              onChange(index, {
                                manual_inspection: event.target.checked ? 1 : 0,
                                status: "Rejected",
                              })
                            }
                          />
                          Manual Inspection
                        </label>
                        {row.formula_based_criteria ? (
                          <p className="text-sm">
                            Acceptance Criteria Formula:{" "}
                            <code className="break-all">
                              {row.acceptance_formula}
                            </code>
                          </p>
                        ) : !row.numeric ? (
                          <label className="block max-w-sm text-sm">
                            Acceptance Criteria Value
                            <input
                              className={`${cellInput} mt-1`}
                              value={row.value || ""}
                              disabled={!editable}
                              onChange={(event) =>
                                onChange(index, {
                                  value: event.target.value,
                                  status: "Rejected",
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {row.numeric ? (
                          <div className="grid grid-cols-3 gap-3 lg:grid-cols-9">
                            {row.values.slice(1).map((_, i) => (
                              <label key={i} className="text-xs">
                                Reading {i + 2}
                                {readingInput(row, index, i + 1)}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {readings.length ? (
        <p className="text-xs text-on-surface-variant">
          Automatic statuses update as you enter readings. Enable Manual
          Inspection for a row to set its status manually. Expand a row for its
          settings and additional readings.
        </p>
      ) : null}
    </div>
  );
}
