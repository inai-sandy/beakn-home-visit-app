// =============================================================================
// HVA-73: lead row shape passed from the server page to the client wrapper
// =============================================================================

export interface LeadRow {
  id: string;
  type: string; // 'Customer' | 'Business'
  name: string;
  phone: string;
  email: string | null;
  cityId: string;
  cityName: string;
  bhk: string | null;
  firmName: string | null;
  businessTypeId: string | null;
  businessTypeName: string | null;
  interest: string[];
  notes: string | null;
  capturedDate: string; // YYYY-MM-DD
  createdAt: string; // ISO timestamp
  convertedToRequestId: string | null;
  convertedAt: string | null; // ISO timestamp when converted
  /** Total visit_requests linked to this contact via contact_id (HVA-73 PR 1). */
  requestCount: number;
  /** HVA-73 PR 3: captor identity for the "captured by other exec" hint. */
  capturedByUserId: string;
  capturedByName: string | null;
  /** Why this row is visible to the viewing exec. */
  visibilityReason: 'captor' | 'assignment';
}

export interface CityOption {
  id: string;
  name: string;
}

export interface BusinessTypeOption {
  id: string;
  name: string;
}
