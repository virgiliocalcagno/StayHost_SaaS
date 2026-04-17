"use client";

const partners = [
  { name: "Airbnb", badge: "Partner Preferido 2024" },
  { name: "Booking.com", badge: "Conectividad Avanzada 2025" },
  { name: "VRBO", badge: "Partner Conectado 2025" },
  { name: "Google", badge: "Vacation Rentals 2025" },
];

export default function PartnersSection() {
  return (
    <section className="py-12 border-y bg-card">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="text-center md:text-left">
            <p className="text-sm font-medium text-muted-foreground">
              Partner de confianza para
            </p>
            <p className="text-sm font-semibold text-foreground">
              lideres de la industria
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
            {partners.map((partner) => (
              <div
                key={partner.name}
                className="flex flex-col items-center gap-1 opacity-60 hover:opacity-100 transition-opacity"
              >
                <div className="flex items-center gap-2">
                  {partner.name === "Airbnb" && (
                    <svg className="w-8 h-8 text-[#FF5A5F]" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12.0003 2C9.15467 2 6.75033 3.36667 5.31167 5.36667C4.56167 6.4 4.06167 7.61667 3.89167 8.93333C3.72167 10.25 3.89167 11.5833 4.38167 12.8C4.87167 14.0167 5.67167 15.0833 6.69167 15.8833C7.35167 16.3833 8.08167 16.7833 8.87167 17.0667L10.0217 17.4667C10.5517 17.6333 11.0917 17.7833 11.6317 17.9L12.0003 18L12.3687 17.9C12.9087 17.7833 13.4487 17.6333 13.9787 17.4667L15.1287 17.0667C15.9187 16.7833 16.6487 16.3833 17.3087 15.8833C18.3287 15.0833 19.1287 14.0167 19.6187 12.8C20.1087 11.5833 20.2787 10.25 20.1087 8.93333C19.9387 7.61667 19.4387 6.4 18.6887 5.36667C17.2503 3.36667 14.846 2 12.0003 2ZM12.0003 16.6667C10.7087 16.6667 9.45867 16.3167 8.38867 15.65C7.31867 14.9833 6.47867 14.0333 5.97867 12.9C5.47867 11.7667 5.33867 10.5 5.57867 9.28333C5.81867 8.06667 6.42867 6.95 7.32867 6.05C8.22867 5.15 9.34533 4.54 10.562 4.3C11.7787 4.06 13.0453 4.2 14.1787 4.7C15.312 5.2 16.262 6.04 16.9287 7.11C17.5953 8.18 17.9453 9.43 17.9453 10.7217C17.9453 12.2967 17.3203 13.8067 16.2203 14.9067C15.1203 16.0067 13.6103 16.6317 12.0353 16.6317L12.0003 16.6667Z"/>
                    </svg>
                  )}
                  {partner.name === "Booking.com" && (
                    <div className="w-8 h-8 bg-[#003580] rounded flex items-center justify-center text-white font-bold text-sm">B.</div>
                  )}
                  {partner.name === "VRBO" && (
                    <div className="w-8 h-8 bg-[#3B5998] rounded flex items-center justify-center text-white font-bold text-xs">V</div>
                  )}
                  {partner.name === "Google" && (
                    <svg className="w-6 h-6" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                  )}
                </div>
                <span className="text-xs text-muted-foreground text-center max-w-[100px]">
                  {partner.badge}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
