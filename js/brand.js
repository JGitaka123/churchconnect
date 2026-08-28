/**
 * Maximum Miracle Centre - brand configuration.
 *
 * This is the SINGLE place to change org identity, palette, currency and
 * campuses. Nothing else in the app hardcodes the client's name or colours;
 * the CSS reads the same palette from the tokens in styles.css :root.
 *
 * PALETTE NOTE: the hex values below are a considered match for MMC's
 * royal-blue-and-gold identity, set from public brand material. If the church
 * supplies exact brand hex codes, change them here and in the matching
 * `--mmc-*` tokens at the top of styles.css - nothing else needs to move.
 */
(function () {
    const Brand = {
        // ---- Identity -------------------------------------------------------
        name: 'Maximum Miracle Centre',
        shortName: 'MMC',
        tagline: 'Reaching the lost, restoring the broken',
        established: 1995,
        website: 'https://maximummiracle.org',
        // Contact + news bullet defaults for the member app (overridable by
        // the super admin from Settings > Church Profile).
        contactEmail: 'office@maximummiracle.org',
        contactPhone: '+254712345678',
        newsBullet: 'Sunday services at 8:30 AM & 10:00 AM - all are welcome. Midweek prayer every Wednesday at 6:00 PM.',
        // Church YouTube channel - powers the YouTube-style Sermons feed in the
        // member app. The super admin can change it from Settings > Church
        // Profile or directly from the Sermons tab.
        youtubeChannel: 'https://youtube.com/@churchofelohimkaloleni',

        // ---- Palette (mirrors the --mmc-* tokens in styles.css) -------------
        palette: {
            royal: '#1d4ed8',
            royalLight: '#3b82f6',
            gold: '#f0b429',
            goldDeep: '#c8890f',
            success: '#10b981',
            danger: '#ef4444'
        },

        // ---- Money ----------------------------------------------------------
        // Kenya Shilling. Rendered as "Ksh 12,500" - no decimals for whole
        // shillings, which is how Kenyan churches actually report giving.
        currency: { code: 'KES', symbol: 'Ksh', locale: 'en-KE' },

        /** Format an amount as Kenyan Shillings. */
        money(amount, opts) {
            const n = Number(amount) || 0;
            const decimals = (opts && opts.decimals !== undefined)
                ? opts.decimals
                : (Number.isInteger(n) ? 0 : 2);
            return `${this.currency.symbol} ${n.toLocaleString('en-KE', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            })}`;
        },

        /** Compact form for chart axes and tight stat cards: "Ksh 1.2M". */
        moneyShort(amount) {
            const n = Number(amount) || 0;
            if (Math.abs(n) >= 1e6) return `${this.currency.symbol} ${(n / 1e6).toFixed(1)}M`;
            if (Math.abs(n) >= 1e3) return `${this.currency.symbol} ${(n / 1e3).toFixed(0)}K`;
            return `${this.currency.symbol} ${n}`;
        },

        // ---- Giving channels ------------------------------------------------
        // M-Pesa is the dominant giving rail in Kenya, so it leads and is the
        // default. Paybill/account are placeholders until the church supplies
        // their live short code.
        giving: {
            methods: ['M-Pesa', 'Bank Transfer', 'Cash', 'Card'],
            defaultMethod: 'M-Pesa',
            mpesa: { paybill: '891300', accountName: 'MMC', shortCodeConfirmed: false },
            // M-Pesa paybill charges are borne by the payer per Safaricom's
            // tariff band; card is the only rail with a percentage fee.
            fees: { mpesaFlat: 0, cardPercent: 0.029, cardFlat: 30 }
        },

        // ---- Campuses -------------------------------------------------------
        // Real MMC locations. `id` values stay b1/b2/b3 so existing saved data
        // and the seeded database keep working.
        campuses: [
            { id: 'b1', name: 'Nairobi CBD', code: 'NRB', hq: true,
              location: 'Embassy Cinema, Latema Road, off Tom Mboya Street, Nairobi' },
            { id: 'b2', name: 'Kawangware', code: 'KWG', hq: false,
              location: 'Kawangware, Nairobi' },
            { id: 'b3', name: 'Nakuru', code: 'NKR', hq: false,
              location: 'Langa Langa, Kanu Street, Nakuru' }
        ],

        /** Campus display name for an id, with a safe fallback. */
        campusName(id) {
            const c = this.campuses.find((x) => x.id === id);
            return c ? c.name : '';
        },

        // ---- Service pattern -------------------------------------------------
        services: ['1st Service (7:00 AM)', '2nd Service (10:00 AM)', 'Midweek Service (Wed 5:30 PM)'],

        // ---- Ministries ------------------------------------------------------
        ministries: [
            'Worship & Music', 'Ushering', 'Intercession', 'Youth', 'Children',
            'Media & NURU TV', 'Outreach & Evangelism', 'Hospital & Home Care',
            'Family Life & Marriage', 'Children\'s Home'
        ]
    };

    window.MMC_BRAND = Brand;
    // Short alias used throughout the app for money formatting.
    window.money = (amount, opts) => Brand.money(amount, opts);
})();
