import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Text } from "react-native-paper";

import { ClearCartConfirmationDialog } from "@/features/pos/components/ClearCartConfirmationDialog";
import { PosCustomerPickerSheet } from "@/features/pos/components/PosCustomerPickerSheet";
import { ManagerPinApprovalDialog } from "@/features/pos/components/ManagerPinApprovalDialog";
import { PosPriceListPickerSheet } from "@/features/pos/components/PosPriceListPickerSheet";
import { PosUomPickerSheet } from "@/features/pos/components/PosUomPickerSheet";
import { formatPosCurrency } from "@/features/pos/currency";
import { usePosItemBatches } from "@/features/pos/hooks/usePosItemBatches";
import { usePosCustomerLoyalty } from "@/features/pos/hooks/usePosCustomerLoyalty";
import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import {
  PosBatchAllocation,
  PosCartItem,
  PosCartTax,
  PosCartTotals,
  PosCustomerSearchResult,
  PosOrderType,
  PosPricingOverride,
  PosPriceList,
  PosSaleCustomer,
  PosSerialAllocation,
} from "@/features/pos/types";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type PosCartScreenProps = {
  allowCustomerCreation: boolean;
  allowDiscountChange?: boolean;
  allowPriceListSwitching?: boolean;
  allowRateChange?: boolean;
  currency: string;
  currencyPrecision?: number;
  error: string | null;
  hasPendingHold?: boolean;
  holdError?: string | null;
  isHolding?: boolean;
  isOffline?: boolean;
  isUpdating: boolean;
  items: PosCartItem[];
  onBack: () => void;
  onCheckout: () => void;
  onClearSaleCustomer: () => void;
  onSelectSaleCustomer: (customer: PosCustomerSearchResult) => void;
  onSelectPriceList?: (priceList?: string) => void;
  onClear: () => void;
  onHold?: () => Promise<{ name: string } | null>;
  onRemove: (itemCode: string) => void;
  onRetry: () => void;
  onUpdateBatchAllocations?: (
    itemCode: string,
    allocations: PosBatchAllocation[],
  ) => void;
  onUpdateItemNote?: (itemCode: string, note: string) => void;
  onUpdatePricing?: (itemCode: string, override?: PosPricingOverride) => void;
  onUpdateQuantity: (itemCode: string, quantity: number) => void;
  onUpdateSerialAllocations?: (
    itemCode: string,
    allocations: PosSerialAllocation[],
  ) => void;
  onUpdateUom?: (itemCode: string, uom: string) => void;
  orderType: PosOrderType;
  posProfile?: string;
  priceList?: string;
  priceListFallbackNotice?: string | null;
  priceListOptions?: PosPriceList[];
  requireManagerPinForItemRemoval?: boolean;
  requiresCustomer: boolean;
  sourceInvoice?: { doctype: string; name: string } | null;
  defaultSaleCustomer: PosSaleCustomer | null;
  saleCustomer: PosSaleCustomer | null;
  subtotal: number;
  taxes: PosCartTax[];
  totals: PosCartTotals;
};

function formatCurrency(amount: number, currency: string, precision = 2) {
  return formatPosCurrency(amount, currency, precision);
}

function pricingRuleLabel(pricingRules: PosCartItem["pricing_rules"]) {
  if (Array.isArray(pricingRules))
    return pricingRules.filter(Boolean).join(", ");
  return pricingRules?.trim() || "";
}

function pricingOverrideLabel(
  override: PosPricingOverride,
  currency: string,
  precision: number,
) {
  if (override.type === "rate")
    return `rate set to ${formatCurrency(override.value, currency, precision)}`;
  if (override.type === "discount_percentage")
    return `${override.value}% discount`;
  return `${formatCurrency(override.value, currency, precision)} discount`;
}

function PricingEditor({
  allowDiscountChange,
  allowRateChange,
  currency,
  currencyPrecision,
  disabled,
  item,
  onUpdate,
}: {
  allowDiscountChange: boolean;
  allowRateChange: boolean;
  currency: string;
  currencyPrecision: number;
  disabled: boolean;
  item: PosCartItem;
  onUpdate: (override?: PosPricingOverride) => void;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const [rate, setRate] = useState(String(item.rate));
  const [discountPercentage, setDiscountPercentage] = useState(
    String(item.discount_percentage || 0),
  );
  const [discountAmount, setDiscountAmount] = useState(
    String(item.discount_amount || 0),
  );
  const [error, setError] = useState<string | null>(null);

  function apply(type: PosPricingOverride["type"], rawValue: string) {
    const value = Number(rawValue);
    if (
      !rawValue.trim() ||
      !Number.isFinite(value) ||
      value < 0 ||
      (type === "discount_percentage" && value > 100)
    ) {
      setError(
        type === "discount_percentage"
          ? "Enter a discount from 0 to 100%."
          : "Enter a valid non-negative amount.",
      );
      return;
    }
    setError(null);
    onUpdate({ type, value });
  }

  function updateDiscountPercentage(value: string) {
    setDiscountPercentage(value);
    const percentage = Number(value);
    if (value && Number.isFinite(percentage))
      setDiscountAmount(
        String(
          Math.round((item.price_list_rate ?? item.rate) * percentage) / 100,
        ),
      );
  }

  function updateDiscountAmount(value: string) {
    setDiscountAmount(value);
    const amount = Number(value);
    const priceListRate = item.price_list_rate ?? item.rate;
    if (value && Number.isFinite(amount) && priceListRate > 0)
      setDiscountPercentage(
        String(Math.round((amount / priceListRate) * 10000) / 100),
      );
  }

  if (!allowRateChange && !allowDiscountChange) return null;
  return (
    <View style={styles.pricingEditor}>
      <Text style={styles.pricingEditorTitle}>Manual pricing</Text>
      <Text style={styles.pricingEditorMeta}>
        Price-list rate:{" "}
        {formatCurrency(
          item.price_list_rate ?? item.rate,
          currency,
          currencyPrecision,
        )}
      </Text>
      {allowRateChange ? (
        <View style={styles.pricingField}>
          <Text style={styles.pricingFieldLabel}>Selling rate</Text>
          <View style={styles.pricingInputRow}>
            <TextInput
              accessibilityLabel={`Selling rate for ${item.item_name}`}
              editable={!disabled}
              inputMode="decimal"
              keyboardType="decimal-pad"
              onChangeText={setRate}
              style={styles.pricingInput}
              value={rate}
            />
            <Pressable
              accessibilityLabel={`Apply selling rate for ${item.item_name}`}
              disabled={disabled}
              onPress={() => apply("rate", rate)}
              style={[
                styles.pricingApplyButton,
                disabled && styles.controlDisabled,
              ]}
            >
              <Text style={styles.pricingApplyLabel}>Apply</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {allowDiscountChange ? (
        <View style={styles.pricingFields}>
          <View style={styles.pricingField}>
            <Text style={styles.pricingFieldLabel}>Discount %</Text>
            <View style={styles.pricingInputRow}>
              <TextInput
                accessibilityLabel={`Discount percentage for ${item.item_name}`}
                editable={!disabled}
                inputMode="decimal"
                keyboardType="decimal-pad"
                onChangeText={updateDiscountPercentage}
                style={styles.pricingInput}
                value={discountPercentage}
              />
              <Pressable
                accessibilityLabel={`Apply discount percentage for ${item.item_name}`}
                disabled={disabled}
                onPress={() => apply("discount_percentage", discountPercentage)}
                style={[
                  styles.pricingApplyButton,
                  disabled && styles.controlDisabled,
                ]}
              >
                <Text style={styles.pricingApplyLabel}>Apply</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.pricingField}>
            <Text style={styles.pricingFieldLabel}>Discount amount</Text>
            <View style={styles.pricingInputRow}>
              <TextInput
                accessibilityLabel={`Discount amount for ${item.item_name}`}
                editable={!disabled}
                inputMode="decimal"
                keyboardType="decimal-pad"
                onChangeText={updateDiscountAmount}
                style={styles.pricingInput}
                value={discountAmount}
              />
              <Pressable
                accessibilityLabel={`Apply discount amount for ${item.item_name}`}
                disabled={disabled}
                onPress={() => apply("discount_amount", discountAmount)}
                style={[
                  styles.pricingApplyButton,
                  disabled && styles.controlDisabled,
                ]}
              >
                <Text style={styles.pricingApplyLabel}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {item.pricing_override ? (
        <Pressable
          accessibilityLabel={`Reset manual price for ${item.item_name}`}
          disabled={disabled}
          onPress={() => onUpdate(undefined)}
          style={[
            styles.pricingResetButton,
            disabled && styles.controlDisabled,
          ]}
        >
          <Text style={styles.pricingResetLabel}>Reset to price-list rate</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.pricingError}>{error}</Text> : null}
    </View>
  );
}

function BatchAllocationEditor({
  disabled,
  item,
  onSave,
  posProfile,
}: {
  disabled: boolean;
  item: PosCartItem;
  onSave: (allocations: PosBatchAllocation[]) => void;
  posProfile?: string;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const batches = usePosItemBatches({
    enabled: !disabled,
    itemCode: item.item_code,
    posProfile,
  });
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (item.batch_allocations || []).map((allocation) => [
        allocation.batch_no,
        String(allocation.qty),
      ]),
    ),
  );
  const requiredQty = item.qty * Number(item.conversion_factor || 1);
  const rows = (batches.data?.batches || []).map((batch) => ({
    ...batch,
    qty: Number(amounts[batch.batch_no] || 0),
  }));
  const allocatedQty = rows.reduce(
    (total, row) => total + (Number.isFinite(row.qty) ? row.qty : 0),
    0,
  );
  const remainingQty = requiredQty - allocatedQty;
  const hasInvalidQuantity = rows.some(
    (row) =>
      !Number.isFinite(row.qty) ||
      row.qty < 0 ||
      row.qty > Number(row.available_qty || 0),
  );
  const isComplete =
    !hasInvalidQuantity &&
    Math.abs(remainingQty) < 0.000001 &&
    allocatedQty > 0;

  function autoAllocate() {
    let remaining = requiredQty;
    const next: Record<string, string> = {};
    for (const batch of batches.data?.batches || []) {
      const quantity = Math.min(remaining, Number(batch.available_qty || 0));
      if (quantity > 0) next[batch.batch_no] = String(quantity);
      remaining -= quantity;
    }
    setAmounts(next);
  }

  function save() {
    onSave(
      rows
        .filter((row) => row.qty > 0)
        .map(({ available_qty, batch_no, expiry_date, qty }) => ({
          available_qty,
          batch_no,
          expiry_date,
          qty,
        })),
    );
  }

  return (
    <View style={styles.batchEditor}>
      <View style={styles.batchEditorHeader}>
        <View style={styles.batchHeading}>
          <Text style={styles.batchEditorTitle}>Batch allocation</Text>
          <Text style={styles.batchEditorMeta}>
            Select quantities from the currently available batches.
          </Text>
        </View>
        <Pressable
          accessibilityLabel={`Refresh batches for ${item.item_name}`}
          disabled={disabled}
          onPress={batches.reload}
          style={[
            styles.batchRefreshButton,
            disabled && styles.controlDisabled,
          ]}
        >
          <MaterialCommunityIcons
            color={palette.onSurface}
            name="refresh"
            size={18}
          />
        </Pressable>
      </View>
      {batches.isLoading ? (
        <Text style={styles.batchLoading}>Loading batch availability…</Text>
      ) : null}
      {batches.error ? (
        <Text style={styles.batchError}>{batches.error}</Text>
      ) : null}
      {batches.data ? (
        <>
          <View style={styles.batchSummary}>
            <View>
              <Text style={styles.batchSummaryLabel}>Required</Text>
              <Text style={styles.batchSummaryValue}>{requiredQty}</Text>
            </View>
            <View>
              <Text style={styles.batchSummaryLabel}>Allocated</Text>
              <Text style={styles.batchSummaryValue}>{allocatedQty}</Text>
            </View>
            <View>
              <Text style={styles.batchSummaryLabel}>Remaining</Text>
              <Text
                style={[
                  styles.batchSummaryValue,
                  remainingQty < 0 && styles.batchError,
                ]}
              >
                {remainingQty}
              </Text>
            </View>
          </View>
          {batches.data.batches.map((batch) => (
            <View key={batch.batch_no} style={styles.batchRow}>
              <View style={styles.batchRowContent}>
                <Text style={styles.batchName}>{batch.batch_no}</Text>
                <Text style={styles.batchMeta}>
                  Available {batch.available_qty || 0}
                  {batch.expiry_date
                    ? ` · Expires ${batch.expiry_date}`
                    : " · No expiry"}
                </Text>
              </View>
              <TextInput
                accessibilityLabel={`Allocation for batch ${batch.batch_no}`}
                editable={!disabled}
                inputMode="decimal"
                keyboardType="decimal-pad"
                onChangeText={(value) =>
                  setAmounts((current) => ({
                    ...current,
                    [batch.batch_no]: value,
                  }))
                }
                style={styles.batchInput}
                value={amounts[batch.batch_no] || ""}
              />
            </View>
          ))}
          {!batches.data.batches.length ? (
            <Text style={styles.batchLoading}>
              No valid batches currently have stock.
            </Text>
          ) : null}
          {hasInvalidQuantity ? (
            <Text style={styles.batchError}>
              An allocation cannot exceed the batch availability.
            </Text>
          ) : null}
          <View style={styles.batchActions}>
            <Pressable
              accessibilityLabel={`Auto allocate batches for ${item.item_name}`}
              disabled={disabled || !batches.data.batches.length}
              onPress={autoAllocate}
              style={[
                styles.batchSecondaryButton,
                (disabled || !batches.data.batches.length) &&
                  styles.controlDisabled,
              ]}
            >
              <Text style={styles.batchSecondaryLabel}>Auto allocate</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Use automatic batch allocation for ${item.item_name}`}
              disabled={disabled}
              onPress={() => onSave([])}
              style={[
                styles.batchSecondaryButton,
                disabled && styles.controlDisabled,
              ]}
            >
              <Text style={styles.batchSecondaryLabel}>Use automatic</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Save batch allocation for ${item.item_name}`}
              disabled={disabled || !isComplete}
              onPress={save}
              style={[
                styles.batchSaveButton,
                (disabled || !isComplete) && styles.controlDisabled,
              ]}
            >
              <Text style={styles.batchSaveLabel}>Save allocation</Text>
            </Pressable>
          </View>
        </>
      ) : null}
    </View>
  );
}

function SerialAllocationEditor({
  disabled,
  item,
  onSave,
  posProfile,
}: {
  disabled: boolean;
  item: PosCartItem;
  onSave: (allocations: PosSerialAllocation[]) => void;
  posProfile?: string;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const serialData = usePosItemBatches({
    enabled: !disabled,
    itemCode: item.item_code,
    posProfile,
  });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(
    () =>
      new Set(
        (item.serial_allocations || []).map(
          (allocation) => allocation.serial_no,
        ),
      ),
  );
  const required = item.qty * Number(item.conversion_factor || 1);
  const isWholeRequired = Number.isInteger(required) && required > 0;
  const serials = serialData.data?.serials || [];
  const filteredSerials = serials.filter((serial) =>
    serial.serial_no.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function persist(next: Set<string>) {
    if (!isWholeRequired || next.size !== required) return;
    onSave(serials.filter((serial) => next.has(serial.serial_no)));
  }

  function toggle(serialNo: string) {
    const next = new Set(selected);
    if (next.has(serialNo)) next.delete(serialNo);
    else if (isWholeRequired && next.size < required) next.add(serialNo);
    setSelected(next);
    persist(next);
  }

  function addScannedSerial() {
    const matched = serials.find(
      (serial) => serial.serial_no.toLowerCase() === query.trim().toLowerCase(),
    );
    if (matched) {
      toggle(matched.serial_no);
      setQuery("");
    }
  }

  return (
    <View style={styles.serialEditor}>
      <Text style={styles.serialEditorTitle}>Serial numbers</Text>
      <View style={styles.serialSearchRow}>
        <TextInput
          accessibilityLabel={`Search serial numbers for ${item.item_name}`}
          editable={!disabled}
          onChangeText={setQuery}
          placeholder="Scan or search serial number"
          placeholderTextColor={palette.onSurfaceMuted}
          style={styles.serialSearchInput}
          value={query}
        />
        <Pressable
          accessibilityLabel={`Add scanned serial for ${item.item_name}`}
          disabled={disabled || !query.trim()}
          onPress={addScannedSerial}
          style={[
            styles.serialScanButton,
            (disabled || !query.trim()) && styles.controlDisabled,
          ]}
        >
          <Text style={styles.serialScanLabel}>Add</Text>
        </Pressable>
      </View>
      {serialData.isLoading ? (
        <Text style={styles.serialMeta}>Loading available serials…</Text>
      ) : null}
      {serialData.error ? (
        <Text style={styles.serialError}>{serialData.error}</Text>
      ) : null}
      {!isWholeRequired ? (
        <Text style={styles.serialError}>
          Serial-numbered items require a whole-number quantity.
        </Text>
      ) : null}
      {serialData.data ? (
        <>
          {filteredSerials.map((serial) => {
            const isSelected = selected.has(serial.serial_no);
            const isDisabled =
              disabled ||
              (!isSelected && (!isWholeRequired || selected.size >= required));
            return (
              <Pressable
                accessibilityLabel={`Select serial ${serial.serial_no}`}
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: isSelected,
                  disabled: isDisabled,
                }}
                disabled={isDisabled}
                key={serial.serial_no}
                onPress={() => toggle(serial.serial_no)}
                style={[
                  styles.serialRow,
                  isSelected && styles.serialRowSelected,
                  isDisabled && styles.controlDisabled,
                ]}
              >
                <MaterialCommunityIcons
                  color={
                    isSelected
                      ? palette.primary
                      : palette.onSurfaceMuted
                  }
                  name={
                    isSelected ? "checkbox-marked" : "checkbox-blank-outline"
                  }
                  size={21}
                />
                <View style={styles.serialRowContent}>
                  <Text style={styles.serialName}>{serial.serial_no}</Text>
                  {serial.batch_no ? (
                    <Text style={styles.serialMeta}>
                      Batch {serial.batch_no}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {!filteredSerials.length ? (
            <Text style={styles.serialMeta}>
              No matching serial numbers are available.
            </Text>
          ) : null}
          <View style={styles.serialSelectionStatus}>
            <Text
              style={[
                styles.serialSelectionCount,
                selected.size === required
                  ? styles.serialMeta
                  : styles.serialError,
              ]}
            >
              Selected {selected.size} / {required}
            </Text>
            <Text style={styles.serialMeta}>
              {selected.size === required
                ? "Saved automatically"
                : "Select the required serials"}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function CartLine({
  allowDiscountChange,
  allowRateChange,
  currency,
  currencyPrecision,
  disabled,
  item,
  onOpenUomPicker,
  onRemove,
  onUpdateBatchAllocations,
  onUpdateNote,
  onUpdatePricing,
  onUpdateQuantity,
  onUpdateSerialAllocations,
  posProfile,
}: {
  allowDiscountChange: boolean;
  allowRateChange: boolean;
  currency: string;
  currencyPrecision: number;
  disabled: boolean;
  item: PosCartItem;
  onOpenUomPicker: () => void;
  onRemove: () => void;
  onUpdateBatchAllocations: (allocations: PosBatchAllocation[]) => void;
  onUpdateNote: (note: string) => void;
  onUpdatePricing: (override?: PosPricingOverride) => void;
  onUpdateQuantity: (quantity: number) => void;
  onUpdateSerialAllocations: (allocations: PosSerialAllocation[]) => void;
  posProfile?: string;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const [draftQuantity, setDraftQuantity] = useState(String(item.qty));
  const [draftNote, setDraftNote] = useState(item.item_note || "");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [batchExpanded, setBatchExpanded] = useState(false);
  const [serialExpanded, setSerialExpanded] = useState(false);
  const [noteExpanded, setNoteExpanded] = useState(false);
  const maximum =
    item.is_stock_item &&
    !item.allow_negative_stock &&
    item.available_qty !== null
      ? item.available_qty
      : null;
  const itemDisabled = disabled || Boolean(item.is_free_item);
  const pricingRule = pricingRuleLabel(item.pricing_rules);
  const hasRuleDiscount = Boolean(
    item.price_list_rate &&
    item.price_list_rate > item.rate &&
    (pricingRule || item.discount_amount || item.discount_percentage),
  );
  const uomOptions = (item.uoms || []).filter(
    (option, index, options) =>
      options.findIndex((candidate) => candidate.uom === option.uom) === index,
  );
  const canChangeUom = !item.is_free_item && uomOptions.length > 1;
  const isBatchTracked = Boolean(item.has_batch_no && !item.has_serial_no);
  const isSerialTracked = Boolean(item.has_serial_no);
  const canExpandDetails = !item.is_free_item;

  useEffect(() => {
    if (disabled) return;
    const sync = setTimeout(() => setDraftQuantity(String(item.qty)), 0);
    return () => clearTimeout(sync);
  }, [disabled, item.qty]);

  function changeQuantity(value: string) {
    if (/^\d*\.?\d*$/.test(value)) setDraftQuantity(value);
  }

  function commitQuantity() {
    const quantity = Number(draftQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDraftQuantity(String(item.qty));
      return;
    }
    onUpdateQuantity(quantity);
  }

  function saveNote() {
    const note = draftNote.trim();
    if (note !== (item.item_note || "")) onUpdateNote(note);
  }

  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <Pressable
          accessibilityLabel={`${detailsExpanded ? "Hide" : "View"} details for ${item.item_name}`}
          accessibilityRole={canExpandDetails ? "button" : undefined}
          disabled={!canExpandDetails}
          onPress={() => setDetailsExpanded((current) => !current)}
          style={styles.itemMain}
        >
          <View style={styles.itemNameRow}>
            <Text numberOfLines={2} style={styles.itemName}>
              {item.item_name}
            </Text>
            {item.is_free_item ? (
              <Text style={styles.freeBadge}>Free item</Text>
            ) : null}
            {item.is_product_bundle ? (
              <Text style={styles.bundleBadge}>Bundle</Text>
            ) : null}
          </View>
          <Text style={styles.itemCode}>{item.item_code}</Text>
          {hasRuleDiscount ? (
            <Text style={styles.originalRate}>
              {formatCurrency(
                item.price_list_rate || 0,
                currency,
                currencyPrecision,
              )}
            </Text>
          ) : null}
          <Text style={styles.itemRate}>
            {formatCurrency(item.rate, currency, currencyPrecision)} ·{" "}
            {item.uom || "Unit"}
          </Text>
          {canExpandDetails ? (
            <View style={styles.detailsHint}>
              <Text style={styles.detailsHintLabel}>
                {detailsExpanded ? "Hide details" : "View details"}
              </Text>
              <MaterialCommunityIcons
                color={palette.onSurfaceMuted}
                name={detailsExpanded ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityLabel={`Remove ${item.item_name} from cart`}
          disabled={itemDisabled}
          onPress={onRemove}
          style={[styles.removeButton, itemDisabled && styles.controlDisabled]}
        >
          <MaterialCommunityIcons
            color={palette.error}
            name="trash-can-outline"
            size={19}
          />
        </Pressable>
      </View>
      {detailsExpanded ? (
        <View
          accessibilityLabel={`Details for ${item.item_name}`}
          style={styles.detailsPanel}
        >
          {item.description?.trim() ? (
            <Text style={styles.description}>{item.description.trim()}</Text>
          ) : null}
          <PricingEditor
            allowDiscountChange={allowDiscountChange}
            allowRateChange={allowRateChange}
            currency={currency}
            currencyPrecision={currencyPrecision}
            disabled={itemDisabled}
            item={item}
            key={`${item.rate}-${item.discount_percentage || 0}-${item.discount_amount || 0}`}
            onUpdate={onUpdatePricing}
          />
          {item.pricing_override ? (
            <Text style={styles.pricingAudit}>
              Manual price override:{" "}
              {pricingOverrideLabel(
                item.pricing_override,
                currency,
                currencyPrecision,
              )}{" "}
              · {item.pricing_override_by || "current cashier"}
            </Text>
          ) : null}
          {isBatchTracked ? (
            <View style={styles.batchSection}>
              <Pressable
                accessibilityLabel={`${batchExpanded ? "Hide" : "Edit"} batch allocation for ${item.item_name}`}
                disabled={itemDisabled}
                onPress={() => setBatchExpanded((current) => !current)}
                style={styles.batchSectionHeader}
              >
                <View style={styles.batchHeading}>
                  <Text style={styles.batchSectionTitle}>Batch allocation</Text>
                  <Text style={styles.batchSectionMeta}>
                    {item.batch_allocations?.length
                      ? `${item.batch_allocations.length} batch${item.batch_allocations.length === 1 ? "" : "es"} selected`
                      : "Automatic allocation"}
                  </Text>
                </View>
                <MaterialCommunityIcons
                  color={palette.onSurfaceMuted}
                  name={batchExpanded ? "chevron-up" : "chevron-down"}
                  size={20}
                />
              </Pressable>
              {batchExpanded ? (
                <BatchAllocationEditor
                  disabled={itemDisabled}
                  item={item}
                  key={`${item.qty}-${item.conversion_factor || 1}-${JSON.stringify(item.batch_allocations || [])}`}
                  onSave={onUpdateBatchAllocations}
                  posProfile={posProfile}
                />
              ) : null}
            </View>
          ) : null}
          {isSerialTracked ? (
            <View style={styles.serialSection}>
              <Pressable
                accessibilityLabel={`${serialExpanded ? "Hide" : "Edit"} serial numbers for ${item.item_name}`}
                disabled={itemDisabled}
                onPress={() => setSerialExpanded((current) => !current)}
                style={styles.serialSectionHeader}
              >
                <View style={styles.batchHeading}>
                  <Text style={styles.serialSectionTitle}>Serial numbers</Text>
                  <Text style={styles.serialSectionMeta}>
                    {item.serial_allocations?.length || 0} of{" "}
                    {item.qty * Number(item.conversion_factor || 1)} selected
                  </Text>
                </View>
                <MaterialCommunityIcons
                  color={palette.onSurfaceMuted}
                  name={serialExpanded ? "chevron-up" : "chevron-down"}
                  size={20}
                />
              </Pressable>
              {serialExpanded ? (
                <SerialAllocationEditor
                  disabled={itemDisabled}
                  item={item}
                  key={`${item.qty}-${item.conversion_factor || 1}-${JSON.stringify(item.serial_allocations || [])}`}
                  onSave={onUpdateSerialAllocations}
                  posProfile={posProfile}
                />
              ) : null}
            </View>
          ) : null}
          {canChangeUom ? (
            <Pressable
              accessibilityLabel={`Change unit for ${item.item_name}`}
              disabled={disabled}
              onPress={onOpenUomPicker}
              style={[styles.uomSelector, disabled && styles.controlDisabled]}
            >
              <View>
                <Text style={styles.uomLabel}>Unit of measure</Text>
                <Text style={styles.uomValue}>{item.uom || "Unit"}</Text>
              </View>
              <MaterialCommunityIcons
                color={palette.onSurfaceMuted}
                name="chevron-right"
                size={20}
              />
            </Pressable>
          ) : null}
          <View style={styles.noteEditor}>
            <Pressable
              accessibilityLabel={`${noteExpanded ? "Hide" : "Edit"} note for ${item.item_name}`}
              onPress={() => setNoteExpanded((current) => !current)}
              style={styles.noteHeader}
            >
              <View style={styles.noteHeaderContent}>
                <Text style={styles.noteLabel}>Item note</Text>
                <Text numberOfLines={1} style={styles.notePreview}>
                  {draftNote.trim() || "No note added"}
                </Text>
              </View>
              <MaterialCommunityIcons
                color={palette.onSurfaceMuted}
                name={noteExpanded ? "chevron-up" : "chevron-down"}
                size={20}
              />
            </Pressable>
            {noteExpanded ? (
              <View style={styles.noteContent}>
                <TextInput
                  accessibilityLabel={`Note for ${item.item_name}`}
                  editable={!disabled}
                  maxLength={500}
                  multiline
                  onBlur={saveNote}
                  onChangeText={setDraftNote}
                  placeholder="Add packing, handling, or cashier notes…"
                  placeholderTextColor={palette.onSurfaceMuted}
                  style={styles.noteInput}
                  value={draftNote}
                />
                <Text style={styles.noteCount}>{draftNote.length}/500</Text>
              </View>
            ) : null}
          </View>
          {item.bundle_items?.length ? (
            <View style={styles.bundleComponents}>
              <Text style={styles.bundleComponentsTitle}>
                Bundle components
              </Text>
              {item.bundle_items.map((component, index) => (
                <View
                  key={`${component.item_code}-${index}`}
                  style={styles.bundleComponentRow}
                >
                  <Text style={styles.bundleComponentName}>
                    {component.item_name || component.item_code}
                  </Text>
                  <Text style={styles.bundleComponentQuantity}>
                    ×{component.qty ?? 0} {component.uom || ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.itemFooter}>
        <View style={styles.quantityControl}>
          <Pressable
            accessibilityLabel={`Decrease quantity for ${item.item_name}`}
            disabled={itemDisabled}
            onPress={() => onUpdateQuantity(item.qty - 1)}
            style={[
              styles.quantityButton,
              itemDisabled && styles.controlDisabled,
            ]}
          >
            <MaterialCommunityIcons
              color={palette.onSurface}
              name="minus"
              size={18}
            />
          </Pressable>
          <TextInput
            accessibilityLabel={`Quantity for ${item.item_name}`}
            inputMode="decimal"
            keyboardType="decimal-pad"
            editable={!itemDisabled}
            onBlur={commitQuantity}
            onChangeText={changeQuantity}
            onSubmitEditing={commitQuantity}
            selectTextOnFocus
            style={styles.quantityInput}
            value={draftQuantity}
          />
          <Pressable
            accessibilityLabel={`Increase quantity for ${item.item_name}`}
            disabled={itemDisabled || (maximum !== null && item.qty >= maximum)}
            onPress={() => onUpdateQuantity(item.qty + 1)}
            style={[
              styles.quantityButton,
              (itemDisabled || (maximum !== null && item.qty >= maximum)) &&
                styles.quantityButtonDisabled,
            ]}
          >
            <MaterialCommunityIcons
              color={palette.onSurface}
              name="plus"
              size={18}
            />
          </Pressable>
        </View>
        <View style={styles.lineTotal}>
          <Text style={styles.lineTotalLabel}>Line total</Text>
          <Text style={styles.lineTotalAmount}>
            {formatCurrency(
              item.amount ?? item.qty * item.rate,
              currency,
              currencyPrecision,
            )}
          </Text>
        </View>
      </View>
      {maximum !== null ? (
        <Text style={styles.stockHint}>
          Available {maximum} {item.uom || ""}
        </Text>
      ) : null}
      {item.item_tax_template ? (
        <Text style={styles.itemContext}>Tax: {item.item_tax_template}</Text>
      ) : null}
      {pricingRule ? (
        <Text style={styles.pricingRule}>
          Promotion applied: {pricingRule}
          {item.discount_percentage
            ? ` · ${item.discount_percentage}% off`
            : ""}
        </Text>
      ) : null}
      {item.is_product_bundle && item.bundle_items?.length ? (
        <Text style={styles.itemContext}>
          Includes {item.bundle_items.length} bundle component
          {item.bundle_items.length === 1 ? "" : "s"}.
        </Text>
      ) : null}
    </View>
  );
}

export function PosCartScreen({
  allowCustomerCreation,
  allowDiscountChange = false,
  allowPriceListSwitching = false,
  allowRateChange = false,
  currency,
  currencyPrecision = 2,
  defaultSaleCustomer,
  error,
  hasPendingHold = false,
  holdError,
  isHolding = false,
  isOffline: isOfflineProp,
  isUpdating,
  items,
  onBack,
  onCheckout,
  onClear,
  onHold,
  onClearSaleCustomer,
  onRemove,
  onRetry,
  onSelectPriceList,
  onSelectSaleCustomer,
  onUpdateBatchAllocations,
  onUpdateItemNote,
  onUpdatePricing,
  onUpdateQuantity,
  onUpdateSerialAllocations,
  onUpdateUom,
  orderType,
  posProfile,
  priceList,
  priceListFallbackNotice,
  priceListOptions = [],
  requireManagerPinForItemRemoval = false,
  requiresCustomer,
  saleCustomer,
  sourceInvoice,
  subtotal,
  taxes,
  totals,
}: PosCartScreenProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const { connectionStatus } = useNetworkStatus();
  const isOffline = isOfflineProp ?? connectionStatus === "offline";
  const displayCurrency = (amount: number, amountCurrency = currency) =>
    formatCurrency(amount, amountCurrency, currencyPrecision);
  const [clearConfirmationVisible, setClearConfirmationVisible] =
    useState(false);
  const [holdFeedback, setHoldFeedback] = useState<string | null>(null);
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);
  const [priceListPickerVisible, setPriceListPickerVisible] = useState(false);
  const [uomPickerItem, setUomPickerItem] = useState<PosCartItem | null>(null);
  const [managerPinItem, setManagerPinItem] = useState<PosCartItem | null>(
    null,
  );
  const customerLoyalty = usePosCustomerLoyalty(
    saleCustomer?.customer,
    posProfile,
    !isOffline,
  );
  const isUsingDefaultCustomer = Boolean(
    saleCustomer?.customer &&
    defaultSaleCustomer?.customer &&
    saleCustomer.customer === defaultSaleCustomer.customer,
  );
  const defaultPriceList = saleCustomer?.defaultPriceList || undefined;
  const activePriceList = priceList || defaultPriceList;
  const isCartBusy = isUpdating || isHolding || hasPendingHold || isOffline;
  const canHold = Boolean(onHold) && orderType === "Invoice";

  async function holdCart() {
    const heldInvoice = await onHold?.();
    if (heldInvoice)
      setHoldFeedback(
        `${heldInvoice.name} is held. You can continue it from Held Invoices.`,
      );
  }

  return (
    <KeyboardAwareFormScroll
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={styles.scrollView}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to items"
          onPress={onBack}
          style={styles.backButton}
        >
          <MaterialCommunityIcons
            color={palette.onSurface}
            name="arrow-left"
            size={22}
          />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>Cart</Text>
          <Text style={styles.subtitle}>{orderType}</Text>
        </View>
        {items.length ? (
          <Pressable
            accessibilityLabel="Clear cart"
            disabled={isCartBusy}
            onPress={() => setClearConfirmationVisible(true)}
            style={[styles.clearButton, isCartBusy && styles.controlDisabled]}
          >
            <Text style={styles.clearButtonLabel}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {items.length ? (
        <>
          <Pressable
            accessibilityHint="Opens a searchable customer list"
            accessibilityLabel="Select sale customer"
            disabled={isCartBusy}
            onPress={() => setCustomerPickerVisible(true)}
            style={[
              styles.customerSelector,
              isCartBusy && styles.controlDisabled,
            ]}
          >
            <View style={styles.customerSelectorMain}>
              <Text numberOfLines={1} style={styles.customerSelectorValue}>
                {saleCustomer?.customerName || "Select customer"}
              </Text>
              <Text numberOfLines={1} style={styles.customerSelectorMeta}>
                {saleCustomer?.customer || "Search or choose from the list"}
              </Text>
            </View>
            <MaterialCommunityIcons
              color={palette.onSurfaceMuted}
              name="chevron-down"
              size={20}
            />
          </Pressable>
          {saleCustomer && !isUsingDefaultCustomer ? (
            <Pressable
              accessibilityLabel="Use default sale customer"
              disabled={isCartBusy}
              onPress={onClearSaleCustomer}
              style={[
                styles.clearCustomerButton,
                isCartBusy && styles.controlDisabled,
              ]}
            >
              <Text style={styles.clearCustomerButtonLabel}>
                Use default customer
              </Text>
            </Pressable>
          ) : null}
          {saleCustomer && customerLoyalty.isLoading ? (
            <Text style={styles.loyaltyLoading}>Checking loyalty balance…</Text>
          ) : null}
          {saleCustomer && customerLoyalty.error ? (
            <Text style={styles.loyaltyError}>
              Loyalty details are unavailable right now. You can continue the
              sale and try again later.
            </Text>
          ) : null}
          {saleCustomer && customerLoyalty.data?.enrolled ? (
            <View
              accessibilityLabel="Customer loyalty status"
              style={styles.loyaltyCard}
            >
              <MaterialCommunityIcons
                color={palette.primary}
                name="star-circle-outline"
                size={21}
              />
              <View style={styles.loyaltyContent}>
                <Text style={styles.loyaltyTitle}>
                  {customerLoyalty.data.program || "Loyalty"}
                  {customerLoyalty.data.tier
                    ? ` · ${customerLoyalty.data.tier}`
                    : ""}
                </Text>
                <Text style={styles.loyaltyMeta}>
                  {Math.max(
                    Math.floor(customerLoyalty.data.points || 0),
                    0,
                  ).toLocaleString()}{" "}
                  points available
                  {customerLoyalty.data.redemption_value
                    ? ` · ${displayCurrency(customerLoyalty.data.redemption_value, customerLoyalty.data.currency || currency)}`
                    : ""}
                </Text>
              </View>
            </View>
          ) : null}
          {allowPriceListSwitching && priceListOptions.length ? (
            <Pressable
              accessibilityLabel="Select price list for this sale"
              disabled={isCartBusy}
              onPress={() => setPriceListPickerVisible(true)}
              style={[
                styles.priceListSelector,
                isCartBusy && styles.controlDisabled,
              ]}
            >
              <View>
                <Text style={styles.priceListLabel}>Price list</Text>
                <Text style={styles.priceListValue}>
                  {activePriceList || "Profile default"}
                </Text>
              </View>
              <MaterialCommunityIcons
                color={palette.onSurfaceMuted}
                name="chevron-down"
                size={20}
              />
            </Pressable>
          ) : null}
          {priceListFallbackNotice ? (
            <Text style={styles.loyaltyLoading}>{priceListFallbackNotice}</Text>
          ) : null}
          <View style={styles.itemList}>
            {items.map((item) => (
              <CartLine
                allowDiscountChange={allowDiscountChange}
                allowRateChange={allowRateChange}
                currency={currency}
                currencyPrecision={currencyPrecision}
                disabled={isCartBusy}
                item={item}
                key={item.item_code}
                onOpenUomPicker={() => setUomPickerItem(item)}
                onRemove={() =>
                  requireManagerPinForItemRemoval
                    ? setManagerPinItem(item)
                    : onRemove(item.item_code)
                }
                onUpdateBatchAllocations={(allocations) =>
                  onUpdateBatchAllocations?.(item.item_code, allocations)
                }
                onUpdateNote={(note) =>
                  onUpdateItemNote?.(item.item_code, note)
                }
                onUpdatePricing={(override) =>
                  onUpdatePricing?.(item.item_code, override)
                }
                onUpdateQuantity={(quantity) =>
                  onUpdateQuantity(item.item_code, quantity)
                }
                onUpdateSerialAllocations={(allocations) =>
                  onUpdateSerialAllocations?.(item.item_code, allocations)
                }
                posProfile={posProfile}
              />
            ))}
          </View>
          {isUpdating ? (
            <Text style={styles.updatingText}>Updating cart…</Text>
          ) : null}
          {isHolding ? (
            <Text style={styles.updatingText}>Holding cart…</Text>
          ) : null}
          {holdError ? (
            <View style={styles.errorState}>
              <Text style={styles.errorText}>{holdError}</Text>
              <Pressable
                accessibilityLabel="Retry holding cart"
                disabled={isCartBusy}
                onPress={() => void holdCart()}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorText}>
                Could not refresh current pricing, tax, and stock. Your existing
                cart has been kept.
              </Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                accessibilityLabel="Retry updating cart"
                disabled={isCartBusy}
                onPress={isOffline ? undefined : onRetry}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {requiresCustomer ? (
            <Text style={styles.customerRequired}>
              Select a customer to calculate current pricing, tax, and stock
              before checkout.
            </Text>
          ) : null}
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Net total</Text>
            <Text style={styles.summaryAmount}>
              {displayCurrency(subtotal)}
            </Text>
          </View>
          {taxes.map((tax, index) => (
            <View
              key={`${tax.account_head || tax.description || "tax"}-${index}`}
              style={styles.summaryRow}
            >
              <Text
                style={styles.summaryRowLabel}
              >{`${tax.description || tax.account_head || "Tax"}${tax.rate !== undefined ? ` (${tax.rate}%)` : ""}${tax.included_in_print_rate ? " · included" : ""}`}</Text>
              <Text style={styles.summaryRowAmount}>
                {displayCurrency(tax.tax_amount || 0)}
              </Text>
            </View>
          ))}
          {totals.total_taxes_and_charges !== undefined ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>
                Total taxes and charges
              </Text>
              <Text style={styles.summaryRowAmount}>
                {displayCurrency(totals.total_taxes_and_charges)}
              </Text>
            </View>
          ) : null}
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Grand total</Text>
            <Text style={styles.grandTotalAmount}>
              {displayCurrency(totals.grand_total ?? subtotal)}
            </Text>
          </View>
          {totals.rounded_total !== undefined &&
          totals.rounded_total !== totals.grand_total ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Rounded total</Text>
              <Text style={styles.summaryRowAmount}>
                {displayCurrency(totals.rounded_total)}
              </Text>
            </View>
          ) : null}
          <Text style={styles.checkoutNote}>
            Payment is collected at checkout.
          </Text>
          {holdFeedback ? (
            <Text accessibilityLiveRegion="polite" style={styles.holdFeedback}>
              {holdFeedback}
            </Text>
          ) : null}
          <View style={styles.cartActions}>
            {canHold ? (
              <Pressable
                accessibilityLabel="Hold cart"
                disabled={isCartBusy}
                onPress={() => void holdCart()}
                style={[
                  styles.holdButton,
                  isCartBusy && styles.controlDisabled,
                ]}
              >
                <MaterialCommunityIcons
                  color={palette.onSurface}
                  name="pause"
                  size={18}
                />
                <Text style={styles.holdButtonLabel}>Hold</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={
                sourceInvoice ? "Continue checkout" : "Proceed to checkout"
              }
              disabled={isCartBusy || Boolean(error) || requiresCustomer}
              onPress={onCheckout}
              style={[
                styles.checkoutButton,
                canHold && styles.checkoutButtonWithHold,
                (isCartBusy || error || requiresCustomer) &&
                  styles.checkoutButtonDisabled,
              ]}
            >
              <Text style={styles.checkoutButtonLabel}>
                {sourceInvoice ? "Continue checkout" : "Proceed to checkout"}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            color={palette.onSurfaceMuted}
            name="cart-outline"
            size={42}
          />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>
            Add items from the catalogue to start this {orderType.toLowerCase()}
            .
          </Text>
          {error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                accessibilityLabel="Retry adding item to cart"
                disabled={isOffline}
                onPress={isOffline ? undefined : onRetry}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            accessibilityLabel="Browse items"
            onPress={onBack}
            style={styles.browseButton}
          >
            <Text style={styles.browseButtonLabel}>Browse items</Text>
          </Pressable>
        </View>
      )}
      <PosCustomerPickerSheet
        allowCustomerCreation={allowCustomerCreation}
        isOffline={isOffline}
        onDismiss={() => setCustomerPickerVisible(false)}
        onSelect={(customer) => {
          onSelectSaleCustomer(customer);
          setCustomerPickerVisible(false);
        }}
        posProfile={posProfile}
        visible={customerPickerVisible}
      />
      <PosPriceListPickerSheet
        defaultPriceList={defaultPriceList}
        isOffline={isOffline}
        onDismiss={() => setPriceListPickerVisible(false)}
        onSelect={onSelectPriceList || (() => undefined)}
        options={priceListOptions}
        selectedPriceList={priceList}
        visible={priceListPickerVisible}
      />
      <PosUomPickerSheet
        isOffline={isOffline}
        itemName={uomPickerItem?.item_name || ""}
        onDismiss={() => setUomPickerItem(null)}
        onSelect={(uom) => {
          if (uomPickerItem) onUpdateUom?.(uomPickerItem.item_code, uom);
          setUomPickerItem(null);
        }}
        options={(uomPickerItem?.uoms || []).filter(
          (option, index, options) =>
            options.findIndex((candidate) => candidate.uom === option.uom) ===
            index,
        )}
        selectedUom={uomPickerItem?.uom}
        visible={Boolean(uomPickerItem)}
      />
      <ManagerPinApprovalDialog
        isOffline={isOffline}
        onApproved={() => {
          if (managerPinItem) onRemove(managerPinItem.item_code);
          setManagerPinItem(null);
        }}
        onDismiss={() => setManagerPinItem(null)}
        posProfile={posProfile}
        visible={Boolean(managerPinItem)}
      />
      <ClearCartConfirmationDialog
        isOffline={isOffline}
        onConfirm={() => {
          onClear();
          setClearConfirmationVisible(false);
        }}
        onDismiss={() => setClearConfirmationVisible(false)}
        visible={clearConfirmationVisible}
      />
    </KeyboardAwareFormScroll>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  batchActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  batchEditor: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  batchEditorHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  batchEditorMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
  },
  batchEditorTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  batchError: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  batchHeading: { flex: 1, gap: 2 },
  batchInput: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    height: 36,
    includeFontPadding: false,
    minWidth: 68,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
    textAlign: "center",
    textAlignVertical: "center",
  },
  batchLoading: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  batchMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  batchName: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  batchRefreshButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  batchRow: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  batchRowContent: { flex: 1, gap: 2 },
  batchSaveButton: {
    alignItems: "center",
    backgroundColor: palette.primary,
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  batchSaveLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  batchSecondaryButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  batchSecondaryLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  batchSection: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  batchSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  batchSectionMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  batchSectionTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  batchSummary: {
    backgroundColor: palette.surfaceContainer,
    borderRadius: radii.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  batchSummaryLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  batchSummaryValue: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    marginTop: 2,
  },
  backButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  browseButton: {
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  browseButtonLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  bundleBadge: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    overflow: "hidden",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  bundleComponents: { gap: spacing.xs },
  bundleComponentsTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  bundleComponentName: {
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  bundleComponentQuantity: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  bundleComponentRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  checkoutButton: {
    alignItems: "center",
    backgroundColor: palette.primary,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
  },
  checkoutButtonWithHold: { flex: 1 },
  checkoutButtonDisabled: {
    backgroundColor: palette.disabled,
    opacity: 0.5,
  },
  checkoutButtonLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  checkoutNote: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  clearButton: {
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  clearButtonLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  cartActions: { flexDirection: "row", gap: spacing.sm },
  clearCustomerButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearCustomerButtonLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  controlDisabled: { opacity: 0.5 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  customerSelector: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  customerSelectorMain: { flex: 1, gap: 1 },
  customerSelectorMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  customerSelectorValue: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  customerRequired: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  description: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  detailsHint: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: spacing.xs,
  },
  detailsHintLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  detailsPanel: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  emptyState: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.xxl,
  },
  errorState: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.error,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  errorText: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  emptyText: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  emptyTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  item: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  itemCode: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  itemContext: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  itemFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  itemHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  itemList: { gap: spacing.sm },
  itemMain: { flex: 1, gap: 2 },
  itemNameRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  loyaltyCard: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  loyaltyContent: { flex: 1, gap: 2 },
  loyaltyLoading: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textAlign: "center",
  },
  loyaltyError: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    marginTop: spacing.xs,
  },
  loyaltyMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  loyaltyTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  noteContent: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  noteCount: {
    alignSelf: "flex-end",
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  noteEditor: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  noteHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  noteHeaderContent: { flex: 1, gap: 2 },
  noteInput: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    minHeight: 84,
    padding: spacing.sm,
    textAlignVertical: "top",
  },
  noteLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  notePreview: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  priceListLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  priceListSelector: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  priceListValue: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    marginTop: 2,
  },
  pricingRule: {
    backgroundColor: palette.surfaceContainer,
    borderRadius: radii.sm,
    color: palette.primary,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pricingApplyButton: {
    alignItems: "center",
    backgroundColor: palette.primary,
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  pricingApplyLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  pricingAudit: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.primary,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    padding: spacing.sm,
  },
  pricingEditor: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  pricingEditorMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  pricingEditorTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  pricingError: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  pricingField: { flex: 1, gap: spacing.xs },
  pricingFieldLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  pricingFields: { flexDirection: "row", gap: spacing.sm },
  pricingInput: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    height: 36,
    includeFontPadding: false,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  pricingInputRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  pricingResetButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  pricingResetLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  itemName: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  itemRate: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  originalRate: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textDecorationLine: "line-through",
  },
  lineTotal: { alignItems: "flex-end", gap: 2 },
  lineTotalAmount: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  lineTotalLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  quantityButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  quantityButtonDisabled: { opacity: 0.4 },
  quantityControl: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  retryButton: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  retryButtonLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  quantityInput: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    height: 34,
    includeFontPadding: false,
    lineHeight: typography.lineHeight.compact,
    minWidth: 52,
    paddingHorizontal: spacing.xs,
    paddingVertical: 0,
    textAlign: "center",
    textAlignVertical: "center",
  },
  removeButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  stockHint: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  freeBadge: {
    backgroundColor: palette.primary,
    borderRadius: radii.pill,
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    overflow: "hidden",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  scrollView: { flex: 1 },
  serialEditor: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  serialEditorTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  serialError: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  serialMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  serialName: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  serialRow: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  serialRowContent: { flex: 1, gap: 2 },
  serialRowSelected: { borderColor: palette.primary },
  serialScanButton: {
    alignItems: "center",
    backgroundColor: palette.primary,
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  serialScanLabel: {
    color: palette.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  serialSearchInput: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    height: 38,
    includeFontPadding: false,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  serialSearchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  serialSection: {
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  serialSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  serialSectionMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  serialSectionTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  serialSelectionCount: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  serialSelectionStatus: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  subtitle: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  summary: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  summaryAmount: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  summaryLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryRowAmount: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  summaryRowLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  updatingText: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textAlign: "center",
  },
  uomLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  uomSelector: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  uomValue: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    marginTop: 2,
  },
  grandTotal: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  grandTotalAmount: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  grandTotalLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  holdButton: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainerHigh,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 94,
    paddingHorizontal: spacing.sm,
  },
  holdButtonLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  holdFeedback: {
    color: palette.primary,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  });
}
