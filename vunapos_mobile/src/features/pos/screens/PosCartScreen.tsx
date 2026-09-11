import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Text } from "react-native-paper";

import { PosCustomerPickerSheet } from "@/features/pos/components/PosCustomerPickerSheet";
import { PosPriceListPickerSheet } from "@/features/pos/components/PosPriceListPickerSheet";
import { PosUomPickerSheet } from "@/features/pos/components/PosUomPickerSheet";
import { usePosCustomerLoyalty } from "@/features/pos/hooks/usePosCustomerLoyalty";
import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
import {
  PosCartItem,
  PosCartTax,
  PosCartTotals,
  PosCustomerSearchResult,
  PosOrderType,
  PosPricingOverride,
  PosPriceList,
  PosSaleCustomer,
} from "@/features/pos/types";
import { posDarkColors, radii, spacing, typography } from "@/theme/tokens";

type PosCartScreenProps = {
  allowCustomerCreation: boolean;
  allowDiscountChange?: boolean;
  allowPriceListSwitching?: boolean;
  allowRateChange?: boolean;
  currency: string;
  error: string | null;
  isUpdating: boolean;
  items: PosCartItem[];
  onBack: () => void;
  onCheckout: () => void;
  onClearSaleCustomer: () => void;
  onSelectSaleCustomer: (customer: PosCustomerSearchResult) => void;
  onSelectPriceList?: (priceList?: string) => void;
  onClear: () => void;
  onRemove: (itemCode: string) => void;
  onRetry: () => void;
  onUpdateItemNote?: (itemCode: string, note: string) => void;
  onUpdatePricing?: (itemCode: string, override?: PosPricingOverride) => void;
  onUpdateQuantity: (itemCode: string, quantity: number) => void;
  onUpdateUom?: (itemCode: string, uom: string) => void;
  orderType: PosOrderType;
  posProfile?: string;
  priceList?: string;
  priceListOptions?: PosPriceList[];
  requiresCustomer: boolean;
  defaultSaleCustomer: PosSaleCustomer | null;
  saleCustomer: PosSaleCustomer | null;
  subtotal: number;
  taxes: PosCartTax[];
  totals: PosCartTotals;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    style: "currency",
  }).format(amount);
}

function pricingRuleLabel(pricingRules: PosCartItem["pricing_rules"]) {
  if (Array.isArray(pricingRules))
    return pricingRules.filter(Boolean).join(", ");
  return pricingRules?.trim() || "";
}

function pricingOverrideLabel(override: PosPricingOverride, currency: string) {
  if (override.type === "rate")
    return `rate set to ${formatCurrency(override.value, currency)}`;
  if (override.type === "discount_percentage")
    return `${override.value}% discount`;
  return `${formatCurrency(override.value, currency)} discount`;
}

function PricingEditor({
  allowDiscountChange,
  allowRateChange,
  currency,
  disabled,
  item,
  onUpdate,
}: {
  allowDiscountChange: boolean;
  allowRateChange: boolean;
  currency: string;
  disabled: boolean;
  item: PosCartItem;
  onUpdate: (override?: PosPricingOverride) => void;
}) {
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
        {formatCurrency(item.price_list_rate ?? item.rate, currency)}
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

function CartLine({
  allowDiscountChange,
  allowRateChange,
  currency,
  disabled,
  item,
  onOpenUomPicker,
  onRemove,
  onUpdateNote,
  onUpdatePricing,
  onUpdateQuantity,
}: {
  allowDiscountChange: boolean;
  allowRateChange: boolean;
  currency: string;
  disabled: boolean;
  item: PosCartItem;
  onOpenUomPicker: () => void;
  onRemove: () => void;
  onUpdateNote: (note: string) => void;
  onUpdatePricing: (override?: PosPricingOverride) => void;
  onUpdateQuantity: (quantity: number) => void;
}) {
  const [draftQuantity, setDraftQuantity] = useState(String(item.qty));
  const [draftNote, setDraftNote] = useState(item.item_note || "");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
  const canExpandDetails = !item.is_free_item;

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
              {formatCurrency(item.price_list_rate || 0, currency)}
            </Text>
          ) : null}
          <Text style={styles.itemRate}>
            {formatCurrency(item.rate, currency)} · {item.uom || "Unit"}
          </Text>
          {canExpandDetails ? (
            <View style={styles.detailsHint}>
              <Text style={styles.detailsHintLabel}>
                {detailsExpanded ? "Hide details" : "View details"}
              </Text>
              <MaterialCommunityIcons
                color={posDarkColors.onSurfaceMuted}
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
            color={posDarkColors.error}
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
            disabled={itemDisabled}
            item={item}
            key={`${item.rate}-${item.discount_percentage || 0}-${item.discount_amount || 0}`}
            onUpdate={onUpdatePricing}
          />
          {item.pricing_override ? (
            <Text style={styles.pricingAudit}>
              Manual price override:{" "}
              {pricingOverrideLabel(item.pricing_override, currency)} ·{" "}
              {item.pricing_override_by || "current cashier"}
            </Text>
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
                color={posDarkColors.onSurfaceMuted}
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
                color={posDarkColors.onSurfaceMuted}
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
                  placeholderTextColor={posDarkColors.onSurfaceMuted}
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
              color={posDarkColors.onSurface}
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
              color={posDarkColors.onSurface}
              name="plus"
              size={18}
            />
          </Pressable>
        </View>
        <View style={styles.lineTotal}>
          <Text style={styles.lineTotalLabel}>Line total</Text>
          <Text style={styles.lineTotalAmount}>
            {formatCurrency(item.amount ?? item.qty * item.rate, currency)}
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
  defaultSaleCustomer,
  error,
  isUpdating,
  items,
  onBack,
  onCheckout,
  onClear,
  onClearSaleCustomer,
  onRemove,
  onRetry,
  onSelectPriceList,
  onSelectSaleCustomer,
  onUpdateItemNote,
  onUpdatePricing,
  onUpdateQuantity,
  onUpdateUom,
  orderType,
  posProfile,
  priceList,
  priceListOptions = [],
  requiresCustomer,
  saleCustomer,
  subtotal,
  taxes,
  totals,
}: PosCartScreenProps) {
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);
  const [priceListPickerVisible, setPriceListPickerVisible] = useState(false);
  const [uomPickerItem, setUomPickerItem] = useState<PosCartItem | null>(null);
  const customerLoyalty = usePosCustomerLoyalty(
    saleCustomer?.customer,
    posProfile,
  );
  const isUsingDefaultCustomer = Boolean(
    saleCustomer?.customer &&
    defaultSaleCustomer?.customer &&
    saleCustomer.customer === defaultSaleCustomer.customer,
  );
  const defaultPriceList = saleCustomer?.defaultPriceList || undefined;
  const activePriceList = priceList || defaultPriceList;

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
            color={posDarkColors.onSurface}
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
            disabled={isUpdating}
            onPress={onClear}
            style={[styles.clearButton, isUpdating && styles.controlDisabled]}
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
            disabled={isUpdating}
            onPress={() => setCustomerPickerVisible(true)}
            style={[
              styles.customerSelector,
              isUpdating && styles.controlDisabled,
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
              color={posDarkColors.onSurfaceMuted}
              name="chevron-down"
              size={20}
            />
          </Pressable>
          {saleCustomer && !isUsingDefaultCustomer ? (
            <Pressable
              accessibilityLabel="Use default sale customer"
              disabled={isUpdating}
              onPress={onClearSaleCustomer}
              style={[
                styles.clearCustomerButton,
                isUpdating && styles.controlDisabled,
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
          {saleCustomer && customerLoyalty.data?.enrolled ? (
            <View
              accessibilityLabel="Customer loyalty status"
              style={styles.loyaltyCard}
            >
              <MaterialCommunityIcons
                color={posDarkColors.primary}
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
                    ? ` · ${formatCurrency(customerLoyalty.data.redemption_value, customerLoyalty.data.currency || currency)}`
                    : ""}
                </Text>
              </View>
            </View>
          ) : null}
          {allowPriceListSwitching && priceListOptions.length ? (
            <Pressable
              accessibilityLabel="Select price list for this sale"
              disabled={isUpdating}
              onPress={() => setPriceListPickerVisible(true)}
              style={[
                styles.priceListSelector,
                isUpdating && styles.controlDisabled,
              ]}
            >
              <View>
                <Text style={styles.priceListLabel}>Price list</Text>
                <Text style={styles.priceListValue}>
                  {activePriceList || "Profile default"}
                </Text>
              </View>
              <MaterialCommunityIcons
                color={posDarkColors.onSurfaceMuted}
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
                disabled={isUpdating}
                item={item}
                key={item.item_code}
                onOpenUomPicker={() => setUomPickerItem(item)}
                onRemove={() => onRemove(item.item_code)}
                onUpdateNote={(note) =>
                  onUpdateItemNote?.(item.item_code, note)
                }
                onUpdatePricing={(override) =>
                  onUpdatePricing?.(item.item_code, override)
                }
                onUpdateQuantity={(quantity) =>
                  onUpdateQuantity(item.item_code, quantity)
                }
              />
            ))}
          </View>
          {isUpdating ? (
            <Text style={styles.updatingText}>Updating cart…</Text>
          ) : null}
          {error ? (
            <View style={styles.errorState}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                accessibilityLabel="Retry updating cart"
                onPress={onRetry}
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
              {formatCurrency(subtotal, currency)}
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
                {formatCurrency(tax.tax_amount || 0, currency)}
              </Text>
            </View>
          ))}
          {totals.total_taxes_and_charges !== undefined ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>
                Total taxes and charges
              </Text>
              <Text style={styles.summaryRowAmount}>
                {formatCurrency(totals.total_taxes_and_charges, currency)}
              </Text>
            </View>
          ) : null}
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Grand total</Text>
            <Text style={styles.grandTotalAmount}>
              {formatCurrency(totals.grand_total ?? subtotal, currency)}
            </Text>
          </View>
          {totals.rounded_total !== undefined &&
          totals.rounded_total !== totals.grand_total ? (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>Rounded total</Text>
              <Text style={styles.summaryRowAmount}>
                {formatCurrency(totals.rounded_total, currency)}
              </Text>
            </View>
          ) : null}
          <Text style={styles.checkoutNote}>
            Payment is collected at checkout.
          </Text>
          <Pressable
            accessibilityLabel="Proceed to checkout"
            disabled={isUpdating || Boolean(error) || requiresCustomer}
            onPress={onCheckout}
            style={[
              styles.checkoutButton,
              (isUpdating || error || requiresCustomer) &&
                styles.checkoutButtonDisabled,
            ]}
          >
            <Text style={styles.checkoutButtonLabel}>Proceed to checkout</Text>
          </Pressable>
        </>
      ) : (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons
            color={posDarkColors.onSurfaceMuted}
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
      <PosCustomerPickerSheet
        allowCustomerCreation={allowCustomerCreation}
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
        onDismiss={() => setPriceListPickerVisible(false)}
        onSelect={onSelectPriceList || (() => undefined)}
        options={priceListOptions}
        selectedPriceList={priceList}
        visible={priceListPickerVisible}
      />
      <PosUomPickerSheet
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
    </KeyboardAwareFormScroll>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    borderColor: posDarkColors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  browseButton: {
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  browseButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  bundleBadge: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    overflow: "hidden",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  bundleComponents: { gap: spacing.xs },
  bundleComponentsTitle: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  bundleComponentName: {
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  bundleComponentQuantity: {
    color: posDarkColors.onSurfaceMuted,
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
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 48,
  },
  checkoutButtonDisabled: {
    backgroundColor: posDarkColors.disabled,
    opacity: 0.5,
  },
  checkoutButtonLabel: {
    color: posDarkColors.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  checkoutNote: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  clearButton: {
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  clearButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  clearCustomerButton: {
    alignItems: "center",
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearCustomerButtonLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  controlDisabled: { opacity: 0.5 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  customerSelector: {
    alignItems: "center",
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
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
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  customerSelectorValue: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  customerRequired: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  description: {
    color: posDarkColors.onSurfaceMuted,
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
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  detailsPanel: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
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
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.error,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  errorText: {
    color: posDarkColors.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  emptyText: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
    textAlign: "center",
  },
  emptyTitle: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  item: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  itemCode: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  itemContext: {
    color: posDarkColors.onSurfaceMuted,
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
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  loyaltyContent: { flex: 1, gap: 2 },
  loyaltyLoading: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textAlign: "center",
  },
  loyaltyMeta: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  loyaltyTitle: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  noteContent: {
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  noteCount: {
    alignSelf: "flex-end",
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  noteEditor: {
    borderColor: posDarkColors.border,
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
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    minHeight: 84,
    padding: spacing.sm,
    textAlignVertical: "top",
  },
  noteLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  notePreview: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  priceListLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  priceListSelector: {
    alignItems: "center",
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  priceListValue: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    marginTop: 2,
  },
  pricingRule: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderRadius: radii.sm,
    color: posDarkColors.primary,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  pricingApplyButton: {
    alignItems: "center",
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  pricingApplyLabel: {
    color: posDarkColors.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  pricingAudit: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.primary,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    lineHeight: typography.lineHeight.body,
    padding: spacing.sm,
  },
  pricingEditor: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  pricingEditorMeta: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  pricingEditorTitle: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  pricingError: {
    color: posDarkColors.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  pricingField: { flex: 1, gap: spacing.xs },
  pricingFieldLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  pricingFields: { flexDirection: "row", gap: spacing.sm },
  pricingInput: {
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: posDarkColors.onSurface,
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
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  pricingResetLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  itemName: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  itemRate: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  originalRate: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textDecorationLine: "line-through",
  },
  lineTotal: { alignItems: "flex-end", gap: 2 },
  lineTotalAmount: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  lineTotalLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  quantityButton: {
    alignItems: "center",
    borderColor: posDarkColors.border,
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
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  retryButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  quantityInput: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: posDarkColors.onSurface,
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
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  stockHint: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  freeBadge: {
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.pill,
    color: posDarkColors.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    overflow: "hidden",
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  scrollView: { flex: 1 },
  subtitle: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  summary: {
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  summaryAmount: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  summaryLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryRowAmount: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  summaryRowLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  updatingText: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
    textAlign: "center",
  },
  uomLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  uomSelector: {
    alignItems: "center",
    borderColor: posDarkColors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.sm,
  },
  uomValue: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    marginTop: 2,
  },
  grandTotal: {
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  grandTotalAmount: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  grandTotalLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
});
