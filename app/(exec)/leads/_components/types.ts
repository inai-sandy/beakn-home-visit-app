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
}

export interface CityOption {
  id: string;
  name: string;
}

export interface BusinessTypeOption {
  id: string;
  name: string;
}
