import {
  summarizeBankTemplateManifest,
  type BankTemplateManifest,
} from "./bank-template-catalog.js";
import { isRecord } from "./client-rest.js";

export type BankSettingsLocation = "Project" | "User";

export interface BankSettingsTarget {
  location: BankSettingsLocation;
  bankId: string;
}

export interface BankSettingsTargetDisplay {
  location: BankSettingsLocation;
  bankId: string;
  locationLabel: string;
  bankLabel: string;
  optionLabel: string;
  reviewLine: string;
}

export function bankSettingsTargetDisplay(target: BankSettingsTarget): BankSettingsTargetDisplay {
  return {
    location: target.location,
    bankId: target.bankId,
    locationLabel: `Location: ${target.location}`,
    bankLabel: `Bank: ${target.bankId}`,
    optionLabel: `${target.location} bank (${target.bankId})`,
    reviewLine: `${target.location} → Bank: ${target.bankId}`,
  };
}

export function bankSettingsTargetLines(target: BankSettingsTarget): string[] {
  const display = bankSettingsTargetDisplay(target);
  return [display.locationLabel, display.bankLabel];
}

export function bankTemplateSummaryLines(manifest: BankTemplateManifest): string[] {
  const summary = summarizeBankTemplateManifest(manifest);
  return [
    `Bank overrides: ${summary.bankOverrideCount}`,
    `Mental models: ${summary.mentalModelCount}`,
    `Directives: ${summary.directiveCount}`,
  ];
}

function objectCount(value: unknown): number {
  return isRecord(value) ? Object.keys(value).length : 0;
}

function arrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function exportedBankTemplateSummaryLines(manifest: unknown): string[] {
  if (!isRecord(manifest)) return ["Bank overrides: 0", "Mental models: 0", "Directives: 0"];
  return [
    `Bank overrides: ${objectCount(manifest.bank)}`,
    `Mental models: ${arrayCount(manifest.mental_models)}`,
    `Directives: ${arrayCount(manifest.directives)}`,
  ];
}

export function bankConfigOverrideSummaryLines(response: unknown): string[] {
  if (!isRecord(response)) return ["Bank overrides: unavailable"];
  const overrides = isRecord(response.overrides) ? response.overrides : undefined;
  const config = isRecord(response.config) ? response.config : undefined;
  const overrideCount = objectCount(overrides);
  const resolvedCount = objectCount(config);
  return [`Bank overrides: ${overrideCount}`, `Resolved config fields: ${resolvedCount}`];
}
