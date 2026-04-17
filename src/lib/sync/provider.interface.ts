export interface StayHostBooking {
  id: string;
  source: 'ical' | 'api' | 'manual';
  status: 'confirmed' | 'cancelled' | 'pending';
  
  // Dates
  checkIn: string; // ISO date
  checkOut: string; // ISO date
  
  // Guest Information (might be missing in iCal)
  guest: {
    firstName?: string;
    lastName?: string;
    fullName: string;
    email?: string;
    phone?: string;
  };

  // Property
  propertyId: string;
  
  // Financials (might be missing in iCal)
  totalPrice?: number;
  currency?: string;

  // Sync Metadata
  rawSourceData?: any;
}

export interface SyncResult {
  success: boolean;
  bookings: StayHostBooking[];
  updatedCount: number;
  error?: string;
}

export interface BookingProvider {
  /**
   * Identifies the provider name (e.g., 'iCal', 'Channex')
   */
  readonly name: string;

  /**
   * Sync bookings for a specific property.
   * @param propertyId StayHost internal property ID
   * @param connectionString The iCal URL or the Channex Property ID
   */
  syncBookings(propertyId: string, connectionString: string): Promise<SyncResult>;

  /**
   * Updates pricing and availability. Only applicable for API providers.
   */
  updateAvailabilityAndRates?(propertyId: string, payload: any): Promise<boolean>;

  /**
   * Imports property details from a URL or API. Only applicable for API providers.
   */
  importProperty?(listingUrl: string): Promise<any>;
}
