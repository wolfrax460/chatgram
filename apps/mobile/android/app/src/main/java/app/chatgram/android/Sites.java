package app.chatgram.android;

/**
 * DOMAIN MOVE: old host keeps working; next build switches the default to
 * https://chatgram.qd.je.
 *
 * <p>Single place that defines both Chatgram hosts for the Android shell. Both
 * hosts are accepted for outbound version checks and for generated URLs.
 * {@code capacitor.config.json} ({@code server.url}) still points at the old
 * host today — that is what installed builds load — and the first build after
 * chatgram.qd.je verifies flips that config (and the order below) to the new
 * host.
 */
final class Sites {

    static final String HOST_OLD = "chatgram-xi.vercel.app";
    static final String HOST_NEW = "chatgram.qd.je";

    static final String SITE_OLD = "https://" + HOST_OLD;
    static final String SITE_NEW = "https://" + HOST_NEW;

    /** Web client entry points for the old/new host. */
    static final String WEB_OLD = SITE_OLD + "/web/";
    static final String WEB_NEW = SITE_NEW + "/web/";

    /** Version checks try the new host first, then the old one as fallback. */
    static final String[] API_BASES = { SITE_NEW, SITE_OLD };

    private Sites() {
    }
}
