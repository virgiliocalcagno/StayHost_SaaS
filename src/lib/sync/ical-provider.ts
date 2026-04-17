import { BookingProvider, StayHostBooking, SyncResult } from './provider.interface';
import { parseICalFeed } from '@/utils/icalParser';

export class ICalProvider implements BookingProvider {
  readonly name = 'iCal';

  async syncBookings(propertyId: string, icalUrl: string): Promise<SyncResult> {
    try {
      // In a real Server Action / API limit, we would fetch this using our proxy
      // Here we assume it's running in an environment that can fetch or
      // it calls the internal /api/ical endpoint
      
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || '';
      
      const res = await fetch(`${baseUrl}/api/ical`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: icalUrl }),
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch iCal: ${res.statusText}`);
      }

      const data = await res.json();
      const icalText = data.ical;

      const parsedBookings = parseICalFeed(icalText, icalUrl);

      const mappedBookings: StayHostBooking[] = parsedBookings.map((pb) => {
        // We know iCal doesn't provide real first/last names generally (only full guest name at best,
        // and usually just "Invitation" or real name if lucky but no email)
        const nameParts = pb.guestName.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

        return {
          id: pb.uid,
          source: 'ical',
          status: 'confirmed',
          checkIn: pb.checkin,
          checkOut: pb.checkout,
          propertyId,
          guest: {
            fullName: pb.guestName,
            firstName,
            lastName,
            phone: pb.phoneLast4 ? `****${pb.phoneLast4}` : undefined,
          },
          rawSourceData: pb,
        };
      });

      return {
        success: true,
        bookings: mappedBookings,
        updatedCount: mappedBookings.length,
      };

    } catch (error: any) {
      return {
        success: false,
        bookings: [],
        updatedCount: 0,
        error: error.message || 'Unknown error syncing iCal',
      };
    }
  }
}
