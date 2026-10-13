import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "react-native-paper";

import { ClearCartConfirmationDialog } from "@/features/pos/components/ClearCartConfirmationDialog";
import { filterShippingAddresses } from "@/features/pos/shippingAddressSearch";
import { PosCustomerComboBox } from "@/features/pos/components/PosCustomerComboBox";
import { PosFixedPageHeader } from "@/features/pos/components/PosFixedPageHeader";
import { ManagerPinApprovalDialog } from "@/features/pos/components/ManagerPinApprovalDialog";
import { PosPriceListPickerSheet } from "@/features/pos/components/PosPriceListPickerSheet";
import { PosUomPickerSheet } from "@/features/pos/components/PosUomPickerSheet";
import { formatPosCurrency } from "@/features/pos/currency";
import { usePosItemBatches } from "@/features/pos/hooks/usePosItemBatches";
import { usePosCustomerLoyalty } from "@/features/pos/hooks/usePosCustomerLoyalty";
import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import { useToast } from "@/components/feedback/ToastProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import {
  PosBatchAllocation,
  PosCartItem,
  PosCartTax,
  PosCartTotals,
  PosCustomerShippingAddress,
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
  isUpdating: boolean;
  items: PosCartItem[];
  onBack: () => void;
  onCheckout: () => void;
  onSelectSaleCustomer: (customer: PosCustomerSearchResult) => void;
  customerShippingAddresses?: PosCustomerShippingAddress[];
  customerShippingAddressesLoading?: boolean;
  shippingAddressName?: string;
  onSelectShippingAddress?: (addressName: string) => void;
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
  priceListOptions?: PosPriceList[];
  requireManagerPinForItemRemoval?: boolean;
  requiresCustomer: boolean;
  showHeader?: boolean;
  sourceInvoice?: { doctype: string; name: string } | null;
  defaultPriceList?: string | null;
  resolvedPriceList?: string;
  saleCustomer: PosSaleCustomer | null;
  subtotal: number;
  taxes: PosCartTax[];
  totals: PosCartTotals;
};

function formatCurrency(amount: number, currency: string, precision = 2) {
  return formatPosCurrency(amount, currency, precision);
}

function shippingAddressText(address?: PosCustomerShippingAddress) {
  if (!address) return "";
  return (
    address.formatted_address ||
    [address.address_line1, address.city, address.state]
      .filter(Boolean)
      .join(", ")
  );
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
  ignoreStock = false,
  item,
  onSave,
  posProfile,
}: {
  disabled: boolean;
  ignoreStock?: boolean;
  item: PosCartItem;
  onSave: (allocations: PosBatchAllocation[]) => void;
  posProfile?: string;
}) {
  const { palette } = useAppearance();
  const toast = useToast();
  const styles = createStyles(palette);
  const batches = usePosItemBatches({
    enabled: !disabled,
    itemCode: item.item_code,
    posProfile,
  });
  useEffect(() => {
    if (batches.error) {
      toast.error(batches.error, {
        title: "Could not load batches",
        dedupeKey: `batch-error:${item.item_code}:${batches.error}`,
      });
    }
  }, [batches.error, item.item_code, toast]);
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
      (!ignoreStock && row.qty > Number(row.available_qty || 0)),
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
  const toast = useToast();
  const styles = createStyles(palette);
  const serialData = usePosItemBatches({
    enabled: !disabled,
    itemCode: item.item_code,
    posProfile,
  });
  useEffect(() => {
    if (serialData.error) {
      toast.error(serialData.error, {
        title: "Could not load serial numbers",
        dedupeKey: `serial-error:${item.item_code}:${serialData.error}`,
      });
    }
  }, [item.item_code, serialData.error, toast]);
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
  orderType,
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
  orderType: PosOrderType;
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
  const availableQuantity =
    item.is_stock_item &&
    !item.allow_negative_stock &&
    item.available_qty !== null
      ? item.available_qty / Number(item.conversion_factor || 1)
      : null;
  const maximum = orderType === "Order" ? null : availableQuantity;
  const isCarton = item.uom?.trim().toLowerCase() === "carton";
  const displayedMaximum =
    availableQuantity === null
      ? null
      : isCarton
        ? Math.floor(availableQuantity + 1e-9)
        : Number(availableQuantity.toFixed(3));
  const availableUom = isCarton ? "Cartons" : item.uom || "units";
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
  const canExpandDetails =
    !item.is_free_item ||
    Boolean(
      item.description ||
        item.item_tax_template ||
        pricingRule ||
        hasRuleDiscount ||
        item.bundle_items?.length,
    );

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
          <View style={styles.itemMainText}>
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
          </View>
          {canExpandDetails ? (
            <MaterialCommunityIcons
              color={palette.onSurfaceMuted}
              name={detailsExpanded ? "chevron-up" : "chevron-down"}
              size={20}
            />
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
          {displayedMaximum !== null ? (
            <Text style={styles.stockHint}>
              Available {availableUom}: {displayedMaximum}
            </Text>
          ) : null}
          {hasRuleDiscount ? (
            <Text style={styles.originalRate}>
              Price-list rate: {formatCurrency(item.price_list_rate || 0, currency, currencyPrecision)}
            </Text>
          ) : null}
          {item.item_tax_template ? (
            <Text style={styles.itemContext}>Tax: {item.item_tax_template}</Text>
          ) : null}
          {pricingRule ? (
            <Text style={styles.pricingRule}>
              Promotion applied: {pricingRule}
              {item.discount_percentage ? ` · ${item.discount_percentage}% off` : ""}
            </Text>
          ) : null}
          {item.is_product_bundle && item.bundle_items?.length ? (
            <Text style={styles.itemContext}>
              Includes {item.bundle_items.length} bundle component
              {item.bundle_items.length === 1 ? "" : "s"}.
            </Text>
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
                  ignoreStock={orderType === "Order"}
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
            disabled={itemDisabled || (maximum !== null && item.qty + 1 > maximum)}
            onPress={() => onUpdateQuantity(item.qty + 1)}
            style={[
              styles.quantityButton,
              (itemDisabled || (maximum !== null && item.qty + 1 > maximum)) &&
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
          <Text style={styles.lineTotalLabel}>
            {item.qty} × {formatCurrency(item.rate, currency, currencyPrecision)}
          </Text>
          <Text style={styles.lineTotalAmount}>
            {formatCurrency(
              item.amount ?? item.qty * item.rate,
              currency,
              currencyPrecision,
            )}
          </Text>
        </View>
      </View>
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
  error,
  hasPendingHold = false,
  holdError,
  isHolding = false,
  isUpdating,
  items,
  onBack,
  onCheckout,
  onClear,
  onHold,
  onRemove,
  onRetry,
  onSelectPriceList,
  onSelectSaleCustomer,
  customerShippingAddresses = [],
  customerShippingAddressesLoading = false,
  shippingAddressName = "",
  onSelectShippingAddress,
  onUpdateBatchAllocations,
  onUpdateItemNote,
  onUpdatePricing,
  onUpdateQuantity,
  onUpdateSerialAllocations,
  onUpdateUom,
  orderType,
  posProfile,
  priceList,
  priceListOptions = [],
  defaultPriceList: profileDefaultPriceList,
  resolvedPriceList,
  requireManagerPinForItemRemoval = false,
  requiresCustomer,
  showHeader = true,
  saleCustomer,
  sourceInvoice,
  subtotal,
  taxes,
  totals,
}: PosCartScreenProps) {
  const { appearance, palette } = useAppearance();
  const toast = useToast();
  const styles = createStyles(palette);
  useEffect(() => {
    if (error) {
      toast.error(error, {
        dedupeKey: `cart-error:${error}`,
        title: "Cart update failed",
      });
    }
  }, [error, toast]);
  useEffect(() => {
    if (holdError) {
      toast.error(holdError, { title: "Could not hold sale" });
    }
  }, [holdError, toast]);
  const displayCurrency = (amount: number, amountCurrency = currency) =>
    formatCurrency(amount, amountCurrency, currencyPrecision);
  const [clearConfirmationVisible, setClearConfirmationVisible] =
    useState(false);
  const [shippingAddressPickerVisible, setShippingAddressPickerVisible] =
    useState(false);
  const [showRequiredFields, setShowRequiredFields] = useState(false);
  const [shippingAddressQuery, setShippingAddressQuery] = useState("");
  const shippingAddressInputRef = useRef<TextInput>(null);
  const [priceListPickerVisible, setPriceListPickerVisible] = useState(false);
  const [uomPickerItem, setUomPickerItem] = useState<PosCartItem | null>(null);
  const [managerPinItem, setManagerPinItem] = useState<PosCartItem | null>(
    null,
  );
  const customerLoyalty = usePosCustomerLoyalty(
    saleCustomer?.customer,
    posProfile,
  );
  const defaultPriceList = saleCustomer?.defaultPriceList || undefined;
  const activePriceList =
    resolvedPriceList || priceList || defaultPriceList || profileDefaultPriceList;
  const selectedShippingAddress =
    customerShippingAddresses.find(
      (address) => address.name === shippingAddressName,
    );
  const matchingShippingAddresses = filterShippingAddresses(
    customerShippingAddresses,
    shippingAddressQuery,
  );
  function dismissShippingAddressPicker() {
    setShippingAddressPickerVisible(false);
    setShippingAddressQuery("");
    Keyboard.dismiss();
  }
  const isCartBusy = isUpdating || isHolding || hasPendingHold;
  const canHold = Boolean(onHold);
  const missingCustomer = requiresCustomer || !saleCustomer?.customer;
  const missingShippingAddress = !shippingAddressName;
  const missingRequiredFields = missingCustomer || missingShippingAddress;

  function proceedToCheckout() {
    if (missingRequiredFields) {
      setShowRequiredFields(true);
      return;
    }
    onCheckout();
  }

  async function holdCart() {
    const heldInvoice = await onHold?.();
    void heldInvoice;
  }

  return (
    <View style={styles.screen}>
      {showHeader ? (
        <PosFixedPageHeader>
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
          </View>
        </PosFixedPageHeader>
      ) : null}
      <KeyboardAwareFormScroll
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.scrollView}
      >
      {items.length ? (
        <>
          <View style={styles.requiredField}>
            <Text style={styles.requiredFieldLabel} testID="cart-customer-label">
              Customer <Text style={styles.requiredStar}>*</Text>
            </Text>
            <PosCustomerComboBox
              accessibilityLabel="Search cart customers"
              allowCustomerCreation={allowCustomerCreation}
              disabled={isCartBusy}
              floatingOptions
              invalid={showRequiredFields && missingCustomer}
              onSelect={(customer) => {
                dismissShippingAddressPicker();
                onSelectSaleCustomer(customer);
              }}
              posProfile={posProfile}
              selectedCustomer={saleCustomer}
            />
          </View>
          <View style={styles.shippingAddressCombo}>
            <Text style={styles.requiredFieldLabel} testID="cart-shipping-address-label">
              Shipping address <Text style={styles.requiredStar}>*</Text>
            </Text>
            <View
              testID="cart-shipping-address-input-row"
              style={[
                styles.shippingAddressSelector,
                showRequiredFields && missingShippingAddress && styles.invalidField,
                (isCartBusy || !saleCustomer) && styles.controlDisabled,
              ]}
            >
              <TextInput
                ref={shippingAddressInputRef}
                accessibilityLabel="Search shipping addresses"
                autoCorrect={false}
                editable={!isCartBusy && Boolean(saleCustomer)}
                onChangeText={(value) => {
                  if (selectedShippingAddress) onSelectShippingAddress?.("");
                  setShippingAddressQuery(value);
                  setShippingAddressPickerVisible(true);
                }}
                onFocus={() => {
                  setShippingAddressQuery("");
                  setShippingAddressPickerVisible(true);
                }}
                placeholder={saleCustomer ? "Search and select an address" : "Select a customer first"}
                placeholderTextColor={palette.onSurfaceMuted}
                selection={shippingAddressPickerVisible ? undefined : { start: 0, end: 0 }}
                style={styles.shippingAddressSearchInput}
                value={
                  shippingAddressPickerVisible
                    ? shippingAddressQuery
                    : shippingAddressText(selectedShippingAddress) ||
                      selectedShippingAddress?.address_title ||
                      selectedShippingAddress?.name ||
                      ""
                }
              />
              <Pressable
                accessibilityLabel={
                  shippingAddressPickerVisible
                    ? "Close shipping address options"
                    : "Show shipping address options"
                }
                disabled={isCartBusy || !saleCustomer}
                onPress={() => {
                  if (shippingAddressPickerVisible) dismissShippingAddressPicker();
                  else shippingAddressInputRef.current?.focus();
                }}
              >
                <MaterialCommunityIcons
                  color={palette.onSurfaceMuted}
                  name={shippingAddressPickerVisible ? "chevron-up" : "chevron-down"}
                  size={20}
                />
              </Pressable>
            </View>
            {shippingAddressPickerVisible && saleCustomer ? (
              <ScrollView
                contentContainerStyle={styles.shippingAddressOptions}
                keyboardShouldPersistTaps="always"
                nestedScrollEnabled
                style={styles.shippingAddressOptionsList}
                testID="cart-shipping-address-options"
              >
                {matchingShippingAddresses.map((address) => (
                  <Pressable
                    accessibilityLabel={`Select shipping address ${address.address_title || address.name}`}
                    key={address.name}
                    onPress={() => {
                      onSelectShippingAddress?.(address.name);
                      dismissShippingAddressPicker();
                    }}
                    style={styles.shippingAddressOption}
                  >
                    <Text style={styles.shippingAddressTitle}>
                      {address.address_title || address.name}
                    </Text>
                    <Text style={styles.customerSelectorMeta}>
                      {shippingAddressText(address)}
                    </Text>
                  </Pressable>
                ))}
                {!matchingShippingAddresses.length ? (
                  <Text style={styles.customerSelectorMeta}>
                    {customerShippingAddressesLoading
                      ? "Loading shipping addresses…"
                      : customerShippingAddresses.length
                        ? "No matching shipping addresses."
                        : "No saved shipping addresses for this customer."}
                  </Text>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
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
                <Text style={styles.priceListValue}>
                  {activePriceList || "Profile default"}
                  {activePriceList === profileDefaultPriceList ? " (Default)" : ""}
                </Text>
              </View>
              <MaterialCommunityIcons
                color={palette.onSurfaceMuted}
                name="chevron-down"
                size={20}
              />
            </Pressable>
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
                orderType={orderType}
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
                That cart change could not be applied. Your last valid cart is
                still shown. Reduce the quantity or try again.
              </Text>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                accessibilityLabel="Retry updating cart"
                disabled={isCartBusy}
                onPress={onRetry}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
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
                disabled={false}
                onPress={onRetry}
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
      </KeyboardAwareFormScroll>
      {items.length ? (
        <View style={styles.cartFooter} testID="cart-footer">
          <ScrollView
            contentContainerStyle={styles.footerSummaryContent}
            showsVerticalScrollIndicator={false}
            style={styles.footerSummaryScroll}
          >
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryRowAmount}>
                {displayCurrency(subtotal)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Taxes</Text>
              <Text style={styles.summaryRowAmount}>
                {displayCurrency(
                  totals.total_taxes_and_charges ??
                    taxes.reduce((sum, tax) => sum + (tax.tax_amount || 0), 0),
                )}
              </Text>
            </View>
            <View style={styles.grandTotal}>
              <Text style={styles.grandTotalLabel}>Grand total</Text>
              <Text style={styles.grandTotalAmount}>
                {displayCurrency(totals.rounded_total ?? totals.grand_total ?? subtotal)}
              </Text>
            </View>
          </ScrollView>
          <View style={styles.cartActions}>
            <View style={styles.secondaryActions} testID="cart-secondary-actions">
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
                    color="#ffffff"
                    name="pause"
                    size={18}
                  />
                  <Text style={styles.holdButtonLabel}>Hold</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="Clear cart"
                disabled={isCartBusy}
                onPress={() => setClearConfirmationVisible(true)}
                style={[styles.clearButton, isCartBusy && styles.controlDisabled]}
              >
                <MaterialCommunityIcons
                  color="#ffffff"
                  name="delete-outline"
                  size={18}
                  testID="clear-cart-icon"
                />
                <Text style={styles.clearButtonLabel}>Clear Cart</Text>
              </Pressable>
            </View>
            {showRequiredFields && missingRequiredFields ? (
              <Text accessibilityRole="alert" style={styles.checkoutRequirementError}>
                {missingCustomer && missingShippingAddress
                  ? "Select a customer and shipping address above."
                  : missingCustomer
                    ? "Select a customer above."
                    : "Select a shipping address above."}
              </Text>
            ) : null}
            <Pressable
              accessibilityLabel={
                sourceInvoice ? "Continue checkout" : "Proceed to checkout"
              }
              accessibilityHint={missingRequiredFields ? "Select a customer and shipping address to continue" : undefined}
              disabled={isCartBusy || Boolean(error)}
              onPress={proceedToCheckout}
              style={[
                styles.checkoutButton,
                (isCartBusy || error || missingRequiredFields) &&
                  styles.checkoutButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.checkoutButtonLabel,
                  (isCartBusy || error || missingRequiredFields) && {
                    color: appearance === "dark" ? palette.surface : palette.onSurface,
                  },
                ]}
              >
                {sourceInvoice ? "Continue checkout" : "Proceed to checkout"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      <PosPriceListPickerSheet
        defaultPriceList={defaultPriceList}
        isOffline={false}
        onDismiss={() => setPriceListPickerVisible(false)}
        onSelect={onSelectPriceList || (() => undefined)}
        options={priceListOptions}
        selectedPriceList={priceList}
        visible={priceListPickerVisible}
      />
      <PosUomPickerSheet
        isOffline={false}
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
        isOffline={false}
        onApproved={() => {
          if (managerPinItem) onRemove(managerPinItem.item_code);
          setManagerPinItem(null);
        }}
        onDismiss={() => setManagerPinItem(null)}
        posProfile={posProfile}
        visible={Boolean(managerPinItem)}
      />
      <ClearCartConfirmationDialog
        isOffline={false}
        onConfirm={() => {
          onClear();
          setClearConfirmationVisible(false);
        }}
        onDismiss={() => setClearConfirmationVisible(false)}
        visible={clearConfirmationVisible}
      />
    </View>
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
    backgroundColor: palette.onSurface,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  checkoutButtonDisabled: {
    backgroundColor: palette.disabled,
  },
  checkoutButtonLabel: {
    color: palette.surface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  checkoutRequirementError: {
    color: palette.error,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: "#b4232b",
    borderRadius: radii.md,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  clearButtonLabel: {
    color: "#ffffff",
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  cartActions: { gap: spacing.xs, paddingTop: spacing.sm },
  cartFooter: {
    backgroundColor: palette.surface,
    borderTopColor: palette.border,
    borderTopWidth: 1,
    maxHeight: "52%",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  footerSummaryContent: { gap: spacing.xs, paddingTop: spacing.sm },
  footerSummaryScroll: { flexShrink: 1 },
  secondaryActions: { flexDirection: "row", gap: spacing.xs },
  controlDisabled: { opacity: 0.5 },
  content: { gap: spacing.sm, padding: spacing.sm, paddingBottom: spacing.md },
  customerSelectorMeta: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  requiredField: { gap: spacing.xs, zIndex: 2 },
  requiredFieldLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 12,
  },
  requiredStar: { color: palette.error },
  invalidField: { borderColor: palette.error },
  shippingAddressCombo: {
    gap: spacing.xs,
    zIndex: 1,
  },
  shippingAddressSelector: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  shippingAddressOptions: { gap: spacing.xs, padding: spacing.xs },
  shippingAddressOptionsList: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    elevation: 8,
    left: 0,
    marginTop: spacing.xs,
    maxHeight: 240,
    position: "absolute",
    right: 0,
    top: "100%",
    zIndex: 1,
  },
  shippingAddressSearchInput: {
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingVertical: 0,
  },
  shippingAddressOption: {
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  shippingAddressTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  description: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
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
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
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
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  itemList: { gap: spacing.xs },
  itemMain: { alignItems: "center", flex: 1, flexDirection: "row", gap: spacing.xs },
  itemMainText: { flex: 1, gap: 2 },
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
  priceListSelector: {
    alignItems: "center",
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
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
  originalRate: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
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
    backgroundColor: palette.surface,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  quantityButtonDisabled: { opacity: 0.4 },
  quantityControl: {
    alignItems: "center",
    flexDirection: "row",
    gap: 0,
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
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    height: 40,
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
    height: 32,
    justifyContent: "center",
    width: 32,
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
  screen: { flex: 1 },
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
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  summaryRow: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  summaryRowAmount: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    flexShrink: 0,
  },
  summaryRowLabel: {
    color: palette.onSurfaceMuted,
    flex: 1,
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
    backgroundColor: "#9a4a0a",
    borderRadius: radii.md,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 94,
    paddingHorizontal: spacing.sm,
  },
  holdButtonLabel: {
    color: "#ffffff",
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  });
}
