"use server";

import { createReportActions } from "./report-action-factory";

export async function resolveReports(input: unknown) {
  return createReportActions().resolveReports(input);
}
