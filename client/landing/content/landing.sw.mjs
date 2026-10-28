/** Kiswahili landing page copy (served at "/sw/"). */
export default {
  code: 'sw',
  meta: {
    // 52 characters
    title: 'Chatgram: programu ya bure ya ujumbe Android, Windows',
    // 131 characters
    description:
      'Chatgram ni programu ya bure ya ujumbe kwa Android, Windows na wavuti: vikundi, hali ya saa 24, simu za sauti na video na Chatgram AI.',
    ogImageAlt:
      'Aikoni ya Chatgram kando ya mazungumzo ya Chatgram AI, pamoja na maneno programu ya bure ya ujumbe kwa Android, Windows na wavuti',
  },
  ui: {
    skipToContent: 'Ruka hadi maudhui',
    mainNavigation: 'Urambazaji mkuu',
    downloadLabel: 'Vipakuliwa vya Chatgram',
    toggleMenu: 'Fungua menyu',
    themeGroup: 'Rangi ya mandhari',
    themeLight: 'Mandhari nyepesi',
    themeDark: 'Mandhari nyeusi',
    themeSystem: 'Mandhari ya mfumo',
    openApp: 'Fungua Chatgram',
  },
  hero: {
    badge: 'Bure · Bila matangazo · Akaunti moja kila mahali',
    h1: 'Chatgram: <em>programu ya bure ya ujumbe</em> kwa Android, Windows na wavuti',
    lead: 'Chatgram inakuweka karibu na watu unaowajali: gumzo la papo hapo lenye ujumbe wa sauti na maudhui, vikundi vinavyoidhinisha maombi ya kujiunga, hali ya saa 24, simu za sauti na video, na Chatgram AI kwa maswali na kusaidia kuandika. Akaunti moja kila mahali, kwa Kiswahili, Kiingereza, Kinyarwanda na Kifaransa.',
    ctaPrimary: { label: 'Fungua Chatgram kwenye kivinjari', href: '/web/' },
    ctaSecondary: { label: 'Pakua programu', href: '#download' },
    ctaWeb: 'Fungua programu ya wavuti',
    platformAndroid: 'Android',
    platformWindows: 'Windows',
    platformWeb: 'Wavuti — hakuna usakinishaji',
  },
  facts: [
    { title: 'Simu zimo', sub: 'Sauti, video na kushiriki skrini' },
    { title: 'Lugha nne', sub: 'Kiswahili, Kiingereza, Kinyarwanda, Kifaransa' },
    { title: 'Uthibitishaji wa hatua mbili', sub: 'Programu ya uthibitisho + misimbo ya kurejesha' },
    { title: 'Bila matangazo, bila ufuatiliaji', sub: 'Mazungumzo yako si bidhaa' },
  ],
  nav: {
    links: [
      { href: '#features', label: 'Vipengele' },
      { href: '#calls', label: 'Simu' },
      { href: '#preview', label: 'Onyesho' },
      { href: '#security', label: 'Faragha' },
      { href: '#download', label: 'Vipakuliwa' },
      { href: '#faq', label: 'Maswali' },
    ],
  },
  features: {
    eyebrow: 'Vipengele',
    title: 'Kila kitu unachohitaji kubaki karibu',
    lead: 'Kila kipengele hapa chini kinafanya kazi kwenye programu sasa — si ahadi ya kesho.',
    items: [
      {
        title: 'Ujumbe kwa undani',
        body: 'Ujumbe wa papo hapo wenye alama za kuwasili na kusomwa, ujumbe wa sauti, picha na faili, majibu, uhariri, nyota, utafutaji na ujumbe uliobandikwa kwenye kikundi.',
      },
      {
        title: 'Simu zinazofaa wakati',
        body: 'Simu za mtu mmoja na za kikundi, sauti au video, zenye kushiriki skrini, kuzima sauti, kudhibiti kamera na kipima muda. Simu ya kikundi inachukua hadi watu 12, wakiwemo 6 kwa video.',
      },
      {
        title: 'Hali inayokuambia nani aliiona',
        body: 'Shiriki picha, video au ujumbe wa sauti unaotoweka baada ya saa 24 — na uone hasa ni nani aliiona, mpya kwanza.',
      },
      {
        title: 'Vikundi vyenye udhibiti halisi',
        body: 'Picha ya kikundi, wasimamizi na ruhusa, kuidhinisha maombi ya kujiunga, viungo vya mwaliko, ujumbe uliobandikwa na @mention.',
      },
      {
        title: 'Chatgram AI kama mazungumzo ya kawaida',
        body: 'Chatgram AI iko kwenye orodha ya gumzo kama mtu mwingine: uliza chochote kwa Kiswahili, Kiingereza, Kinyarwanda au Kifaransa, pata majibu, yapime, au mtaje @Chatgram AI kwenye kikundi.',
      },
      {
        title: 'Arifa zinazofika',
        body: 'Arifa za Android na Windows zinaonyesha hali halisi ya idhini, arifa ya jaribio, chaneli tofauti za ujumbe na simu, na kipindi cha usisumbue.',
      },
      {
        title: 'Faragha unayoweza kudhibiti',
        body: 'Uthibitishaji wa hatua mbili na misimbo ya kurejesha, vipindi unavyoweza kutoka, mipangilio ya faragha kwa kila mtu na alama za kusomwa za hiari. Ujumbe umesimbwa unaposafiri — si kutoka mwisho hadi mwisho, na ukurasa huu unasema hivyo.',
      },
      {
        title: 'Programu za Windows na Android',
        body: 'Programu zote mbili hujisasisha zenyewe: Android hukagua APK mpya, huipakua, huthibitisha checksum na kukuomba uisakinishe; Windows hukagua nyuma ya pazia na kuwasha upya ili kujisasisha.',
      },
    ],
  },
  calls: {
    eyebrow: 'Simu',
    title: 'Simu zinazofanya kazi — na kukuambia zinaposhindwa',
    lead: 'Sauti au video, mtu mmoja au kikundi kizima, kwenye majukwaa yote matatu. Skrini ya simu inaonyesha kinachotokea badala ya kukuacha ukikisia.',
    items: [
      {
        title: 'Mtu mmoja na kikundi',
        body: 'Piga simu mtu kutoka juu ya gumzo au anza simu ya kikundi. Simu ya kikundi inachukua hadi watu 12; watu 6 wa kwanza wanaweza kutumia video na wengine wanaingia kwa sauti.',
      },
      {
        title: 'Sauti na video',
        body: 'Anza kwa sauti au video, zima maikrofoni, zima kamera, na ubadilishe kati ya kipokea sauti, spika na Bluetooth kwenye Android.',
      },
      {
        title: 'Kushiriki skrini',
        body: 'Shiriki dirisha au tab wakati wa simu pale kivinjari au programu ya kompyuta inaruhusu, ukiwa na upau wa kushiriki unaoonekana kwa mpokeaji.',
      },
      {
        title: 'Relay ya TURN kwa mitandao migumu',
        body: 'Chatgram hutoa vitambulisho vya TURN vya muda mfupi kwa simu zisizoweza kuunganisha moja kwa moja, ili NAT kali na mitandao ya simu ipate relay ya akiba. Ikiwa relay haipatikani, uchunguzi unasema hivyo.',
      },
      {
        title: 'Uchunguzi na kurudia bila sauti au video',
        body: 'Skrini ya simu inaonyesha hali ya ICE, jozi ya candidate, ikiwa relay imewekwa, baiti zinazoingia na kutoka na idadi ya nyimbo za mbali zinazocheza. Maudhui yasipofika, Chatgram hurudia muunganisho na kuonyesha sababu.',
      },
    ],
    note: 'Simu ni kati ya watu moja kwa moja (peer-to-peer) na relay ya TURN kama akiba. Ubora hutegemea mitandao yote miwili — uchunguzi upo ili simu mbaya ielezeke badala ya kukisiwa.',
  },
  messaging: {
    eyebrow: 'Ujumbe',
    title: 'Mambo madogo yanayofanya gumzo liwe zuri',
    lead: 'Mazungumzo yale yale kwenye kila kifaa, pamoja na vidhibiti unavyotumia kila siku.',
    items: [
      {
        title: 'Ujumbe wa sauti',
        body: 'Rekodi ujumbe wa sauti kwa mguso mmoja na uutume; hucheza papo hapo kwenye mazungumzo pamoja na muda wake.',
      },
      {
        title: 'Majibu, uhariri na kufuta',
        body: 'Jibu ujumbe mmoja, hariri maandishi yako ukiwa na alama « imehaririwa », futa kwa ajili yako au futa kwa kila mtu.',
      },
      {
        title: 'Nyota na ubandikaji',
        body: 'Weka nyota kwenye ujumbe unaotaka kuupata tena, na ubandike ujumbe mmoja muhimu juu ya kikundi.',
      },
      {
        title: 'Utafutaji na maudhui yaliyoshirikiwa',
        body: 'Tafuta kwenye mazungumzo yako na ufungue picha, video na viungo vya mazungumzo mahali pamoja.',
      },
      {
        title: 'Picha, video na faili',
        body: 'Tuma picha, video na hati zenye maendeleo halisi ya upakiaji na kurudia kunakohifadhi faili.',
      },
    ],
    note: 'Alama za kusomwa na kuwasili ni sehemu ya mazungumzo — na unaweza kuzima alama za kusomwa.',
  },
  preview: {
    eyebrow: 'Onyesho',
    title: 'Angalia ndani',
    lead: 'Programu moja kwenye kila jukwaa, iliyoundwa ikaeleweka mara ya kwanza.',
    shots: [
      {
        shot: 'chats',
        alt: 'Chatgram katika mandhari nyeusi ikionyesha orodha ya gumzo pamoja na kikundi, anwani na alama za ujumbe usiosomwa',
        caption: 'Mazungumzo yako, na Chatgram AI kwenye orodha',
      },
      {
        shot: 'conversation',
        alt: 'Mazungumzo ya Chatgram katika mandhari nyeusi yakionyesha ujumbe uliotumwa na alama za kuwasili na kusomwa',
        caption: 'Gumzo la papo hapo na alama za kuwasili na kusomwa',
      },
    ],
    wide: {
      shot: 'ai',
      alt: 'Chatgram AI imefunguliwa kama mazungumzo ya kawaida ndani ya Chatgram',
      caption: 'Chatgram AI ni mazungumzo kama mengine',
    },
  },
  privacy: {
    eyebrow: 'Faragha',
    title: 'Mazungumzo yako yanabaki yako',
    lead: 'Faragha ya kweli unayoiona na kudhibiti — si maneno ya matangazo.',
    items: [
      {
        title: 'Imesimbwa inaposafiri',
        body: 'Kila ombi na kila muunganisho hupitia HTTPS na WSS kwa cheti halali cha TLS kinachosasishwa kiotomatiki.',
      },
      {
        title: 'Uthibitishaji wa hatua mbili',
        body: 'Ongeza programu ya uthibitisho kwenye akaunti yako, pamoja na misimbo kumi ya kurejesha inayotumika mara moja ikiwa utapoteza simu.',
      },
      {
        title: 'Faragha, kwa kila mtu',
        body: 'Hali ya mtandaoni, kuonekana mara ya mwisho, picha, maelezo, simu na barua pepe — kila kimoja unaweza kukizima, na alama za kusomwa ni za hiari.',
      },
      {
        title: 'Vipindi unavyodhibiti',
        body: 'Ona kila kifaa kilichoingia na utoe vingine kwa mguso mmoja. Kubadilisha nenosiri lako huwatoa kiotomatiki.',
      },
      {
        title: 'Ripoti hufika kwa mtu halisi',
        body: 'Ripoti hufika kwenye kisanduku cha wasimamizi, na maudhui yaliyoripotiwa yanaweza kukaguliwa na wanatimu walioidhinishwa. Kila hatua ya msimamizi imeandikwa kwenye kumbukumbu ya ukaguzi, na akaunti ulizozuia haziwezi kukutumia ujumbe au kukupigia simu.',
      },
      {
        title: 'Inalindwa kwenye seva',
        body: 'Sheria za mazungumzo, majukumu na faragha hutekelezwa kwenye seva, haziaminwi kwa programu. Kuingia kunapunguzwa kasi na kushindwa mara kwa mara huzuia akaunti kwa muda.',
      },
    ],
    note: 'Ujumbe umesimbwa unaposafiri na huhifadhiwa kwenye seva, kwa hivyo seva inaweza kuusoma. Usimbaji fiche kutoka mwisho hadi mwisho ni jambo la kwanza kwenye mpango — hatutadai kinafanya kazi kabla hakijawasili.',
  },
  downloads: {
    eyebrow: 'Vipakuliwa',
    title: 'Pakua Chatgram kwa Android, Windows au wavuti',
    lead: 'Akaunti moja inafanya kazi kwenye zote tatu. Anza kwenye simu, endelea kwenye kompyuta yako.',
    stripLabel: 'Matoleo yaliyochapishwa sasa',
    versionLabel: 'Toleo',
    sizeLabel: 'Ukubwa',
    releasedLabel: 'Ilitolewa',
    fileLabel: 'Faili',
    shaLabel: 'SHA-256',
    requiresLabel: 'Inahitaji',
    bytesSuffix: 'baiti',
    checksumNote: 'Checksum hutambulisha faili iliyochapishwa — linganisha thamani kamili kabla ya kusakinisha.',
    cachedNote:
      'Tunaonyesha toleo la mwisho lililochapishwa wakati mtiririko wa matoleo haupatikani. Angalia toleo hapa chini kabla ya kusakinisha.',
    windows: {
      label: 'Windows',
      title: 'Chatgram kwa Windows',
      meta: 'Programu ya usakinishaji · Haijatiwa sahihi',
      cta: 'Pakua kwa Windows',
      note: 'Ikiwa Windows SmartScreen itakuonya, chagua “Maelezo zaidi” kisha “Endesha hata hivyo”.',
      alt: 'Windows 10 au mpya zaidi, 64-bit · hujisasisha kutoka /downloads.',
      steps: [
        'Pakua na uendeshe programu ya usakinishaji.',
        'SmartScreen inaweza kukuonya kwa sababu toleo halijatiwa sahihi — bofya “Maelezo zaidi” → “Endesha hata hivyo”.',
        'Thibitisha faili kwa Get-FileHash .\\chatgram-windows-setup.exe -Algorithm SHA256.',
        'Chatgram huanza na kubaki kwenye tray unapofunga; masasisho yatajisakinisha kiotomatiki.',
      ],
    },
    android: {
      label: 'Android',
      title: 'Chatgram kwa Android',
      meta: 'APK · Sahihi ya majaribio',
      cta: 'Pakua APK',
      note: 'Ruhusu “Sakinisha programu zisizojulikana” kwa kivinjari chako au programu ya Faili Android inapouliza.',
      alt: 'Usakinishaji wa moja kwa moja · kamera na maikrofoni huombwa tu simu au ujumbe wa sauti unapohitaji.',
      steps: [
        'Pakua APK, kisha ruhusu “Sakinisha programu zisizojulikana” kwa kivinjari chako au programu ya Faili.',
        'Fungua faili, isakinishe na uzindue Chatgram.',
        'Hili ni toleo la upakuaji wa moja kwa moja, si toleo la Play Store. Chatgram hujisasisha yenyewe baadaye.',
      ],
      qrAlt: 'Msimbo wa QR unaofungua upakuaji wa APK ya Chatgram kwa Android',
      qrCaption: 'Skani ili usakinishe',
    },
    web: {
      label: 'Wavuti',
      title: 'Chatgram kwenye kivinjari chako',
      meta: 'Hakuna usakinishaji · Kivinjari cha kisasa',
      body: 'Akaunti ile ile na mazungumzo yale yale — fungua programu ya wavuti kwenye kivinjari cha kisasa. Hakuna cha kupakua.',
      cta: 'Fungua kwenye kivinjari',
      alt: 'Chrome, Edge, Firefox au Safari.',
      steps: [
        'Fungua Chatgram kwenye kivinjari hiki.',
        'Ingia kwa akaunti ile ile unayotumia kwenye simu au kompyuta.',
      ],
    },
  },
  steps: {
    eyebrow: 'Kuanza',
    title: 'Hatua tatu za kuanza',
    lead: 'Kuanzia uzinduzi wa kwanza hadi ujumbe wako wa kwanza chini ya dakika moja.',
    items: [
      {
        title: 'Fungua akaunti yako',
        body: 'Jisajili kwa barua pepe yako, au endelea na Google. Tunatuma msimbo wa tarakimu 6 kuthibitisha ni wewe.',
      },
      {
        title: 'Ongeza anwani zako',
        body: 'Tafuta mtu kwa jina, barua pepe au nambari ya simu na umwongeze. Orodha yako ya anwani inabaki siri yako.',
      },
      {
        title: 'Anza kuzungumza',
        body: 'Gusa anwani kumwambia habari, tuma picha au ujumbe wa sauti, unda kikundi au mpigie simu — sauti au video.',
      },
    ],
  },
  whatsNew: {
    eyebrow: 'Mpya',
    title: 'Maelezo ya toleo',
    lead: 'Kila kitu kilichowasili katika matoleo ya sasa.',
    platformLabels: { windows: 'Windows', android: 'Android', web: 'Wavuti' },
    releases: [
      {
        platform: 'android',
        version: '1.1.7',
        date: '27 Oktoba 2026',
        items: [
          'Arifa za push kupitia Firebase Cloud Messaging (FCM): ujumbe na simu sasa hufika hata Chatgram ikiwa imefungwa au nyuma ya pazia.',
          'Simu inayoingia kwenye skrini nzima: simu inayoingia huamsha skrini na skrini kamili ya Kubali / Kataa (pamoja na kwenye skrini ya kufungia) badala ya bango dogo.',
          'Uchunguzi wa simu: skrini mpya hurekodi ubora wa muunganisho, njia ya ICE/relay na sababu ya kushindwa, ili simu iliyokatika au isiyo na sauti ichunguzwe.',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.2',
        date: '27 Oktoba 2026',
        items: [
          'Mipangilio ya arifa inayoonyesha hali halisi ya arifa za Windows, pamoja na kiungo cha moja kwa moja kwenye ukurasa wa mipangilio ya arifa.',
          'Tahadhari ya simu inayoingia: arifa ya Windows na tahadhari kwenye tray hutangaza simu inayoingia, na kuibofya huleta Chatgram mbele.',
          'Inakuja na mteja mpya wa wavuti: Chatgram AI kama mazungumzo ya kawaida, @Chatgram AI kwenye vikundi, hali na vipengele vya dashibodi ya msimamizi.',
        ],
      },
      {
        platform: 'android',
        version: '1.1.6',
        date: '27 Oktoba 2026',
        items: [
          'Mipangilio ya arifa inayoonyesha hali halisi ya idhini, inafungua mipangilio ya Android na kutuma arifa ya jaribio',
          'Ombi la kuzima uboreshaji wa betri ili Android isicheleweshe arifa',
          'Chaneli ya simu yenye mlio wa simu na kitufe cha spika / kipokea sauti / Bluetooth',
          'Simu: video ya mtu mwingine huanza yenyewe (avatar inaonekana badala ya kitufe cha play), « Inapiga… » inakuwa muda, na skrini ya simu inayoingia inaonyesha anayepiga',
        ],
      },
      {
        platform: 'android',
        version: '1.1.5',
        date: '27 Oktoba 2026',
        items: [
          'Masasisho ndani ya programu: Chatgram hukagua APK mpya, hupakua kwa Wi-Fi au data ya mkononi (kulingana na upatikanaji), huthibitisha checksum, kisha hutoa « Sasisho liko tayari: gusa ili usakinishe »',
          'Skrini inayohitaji sasisho pale toleo lililowekwa halitumiki tena',
          'Hakuna usanidi wa kimya: Android huomba idhini ya kisakinishi mara moja, na hakuna kinachosakinishwa bila kugusa',
        ],
      },
      {
        platform: 'windows',
        version: '1.1.1',
        date: '27 Oktoba 2026',
        items: [
          'Programu ya kompyuta yenye tray, alama ya taskbar na kujisasisha kutoka /downloads',
          'Kuanza unapoingia na arifa za mfumo',
          'Upakuaji wa masasisho nyuma ya pazia na « Washa upya ili usakinishe »; masasisho hufungwa unapofunga',
          'Skrini inayozuia pale toleo linapolazimishwa au ni la chini ya kiwango',
          'Toleo lisilotiwa sahihi — soma mwongozo wa SmartScreen kabla ya kusakinisha',
        ],
      },
      {
        platform: 'android',
        version: '1.1.2',
        date: '27 Oktoba 2026',
        items: [
          'Kurekebisha kuanguka wakati wa kufungua ("Chatgram inasimama"): darasa la kuanzisha na usanidi uliowekwa sasa vinalingana',
          'Toleo dogo lililoboreshwa lenye ufunguo uleule wa sahihi, husakinisha juu ya 1.1.0',
          'Kibodi haifuniki tena sehemu ya ujumbe; ukurasa wa nje ya mtandao unaeleza seva inaposhindwa kufikiwa',
        ],
      },
      {
        platform: 'web',
        version: '1.1.0',
        date: '25 Oktoba 2026',
        items: [
          'Chatgram AI kama mazungumzo ya kawaida, pamoja na @Chatgram AI kwenye vikundi',
          'Simu za sauti na video kwa mazungumzo ya mtu mmoja na vikundi',
          'Zana za udhibiti, maombi ya data na dashibodi ya msimamizi',
        ],
      },
    ],
  },
  faq: {
    eyebrow: 'Maswali',
    title: 'Maswali kuhusu Chatgram, yamejibiwa',
    lead: 'Ikiwa swali lako halipo hapa, liulize kwenye programu na tutaongeza.',
    items: [
      {
        q: 'Chatgram ni bure?',
        a: 'Ndiyo. Hakuna matangazo, usajili, ununuzi ndani ya programu, wala toleo la malipo.',
      },
      {
        q: 'Ninahitaji akaunti tofauti kwa kila kifaa?',
        a: 'Hapana. Akaunti moja inafanya kazi kwenye Android, Windows na wavuti. Ingia kwa barua pepe ile ile kwenye kila kifaa na mazungumzo yako yatakuwa tayari.',
      },
      {
        q: 'Nipakue vipi programu ya Chatgram?',
        a: 'Tumia sehemu ya Vipakuliwa kwenye ukurasa huu: “Pakua kwa Windows” inakupa programu ya usakinishaji na “Pakua APK” inakupa toleo la Android. Viungo vyote viwili vinaelekeza kwenye faili za sasa zilizochapishwa chini ya /downloads/, na kadi zinaonyesha toleo, ukubwa na SHA-256 halisi.',
      },
      {
        q: 'Chatgram inapatikana Rwanda?',
        a: 'Ndiyo. Chatgram inafanya kazi kwenye simu yoyote ya Android au kompyuta ya Windows, inaunga mkono Kiswahili, Kiingereza, Kinyarwanda na Kifaransa, na inatumia nambari za Rwanda +250 kwenye anwani na mipangilio ya akaunti.',
      },
      {
        q: 'Nisakinishe vipi programu ya Android?',
        a: 'Pakua APK, ifungue, na ruhusu “Sakinisha programu zisizojulikana” kwa kivinjari chako au kidhibiti faili Android inapouliza. Chatgram bado haijasambazwa kupitia Play Store, hivyo hii ni kawaida. Hatua zote ziko kwenye mwongozo wa Android.',
      },
      {
        q: 'Windows inaonyesha onyo ninapoanzisha programu. Ni kawaida?',
        a: 'Ndiyo. Programu ya usakinishaji bado haijatiwa sahihi, hivyo Windows SmartScreen inaweza kukuonya mara ya kwanza. Chagua “Maelezo zaidi” kisha “Endesha hata hivyo”. Mwongozo wa Windows una hatua kamili na jinsi ya kuthibitisha faili.',
      },
      {
        q: 'Chatgram AI ni nini na inazungumza lugha gani?',
        a: 'Chatgram AI hujibu maswali, husaidia kuandika na hutafsiri kati ya Kiswahili, Kiingereza, Kinyarwanda na Kifaransa. Inaonekana kwenye orodha ya gumzo kama mtu mwingine, na kwenye kikundi unaweza kumtaja @Chatgram AI. Inaweza kukosea, na majibu huchakatwa na mtoa huduma wa AI wa mtu mwingine.',
      },
      {
        q: 'Arifa hufanya kazi programu ikiwa imefungwa?',
        a: 'Kwenye Android 1.1.7 na matoleo mapya zaidi, ujumbe na simu hufika kupitia Firebase Cloud Messaging hata Chatgram ikiwa imefungwa au nyuma ya pazia. Kwenye Windows, programu ya kompyuta inaonyesha arifa ikiwa inafanya kazi, pamoja na kutoka kwenye tray.',
      },
      {
        q: 'Ujumbe wangu umesimbwa kutoka mwisho hadi mwisho?',
        a: 'Bado. Ujumbe umesimbwa wakati wa kusafiri (HTTPS/WSS) na huhifadhiwa kwenye seva, hivyo seva inaweza kuusoma. Usimbaji fiche kutoka mwisho hadi mwisho ni jambo la kwanza kwenye mpango.',
      },
      {
        q: 'Naweza kupiga simu?',
        a: 'Ndiyo — simu za sauti na video zipo. Gusa aikoni ya simu au kamera juu ya gumzo. Gumzo la mtu mmoja hupiga mtu mmoja; simu ya kikundi inaweza kujumuisha hadi watu 12 kwa wakati mmoja, wakiwemo 6 kwa video.',
      },
    ],
    guidesTitle: 'Miongozo ya hatua kwa hatua',
  },
  footer: {
    tagline: 'Ujumbe rahisi na wa kuaminika kwenye kila kifaa unachotumia.',
    productTitle: 'Bidhaa',
    product: [
      { href: '#features', label: 'Vipengele' },
      { href: '#calls', label: 'Simu' },
      { href: '#preview', label: 'Onyesho' },
      { href: '#download', label: 'Vipakuliwa' },
      { href: '/web/', label: 'Fungua programu ya wavuti' },
    ],
    helpTitle: 'Msaada',
    help: [
      { href: '#how', label: 'Kuanza' },
      { href: '#whats-new', label: 'Mpya' },
      { href: '#faq', label: 'Maswali' },
    ],
    guidesTitle: 'Miongozo',
    legalTitle: 'Kisheria',
    legal: [{ href: '/docs/', label: 'Masharti na Faragha' }],
    bottom: '© {year} Chatgram. Haki zote zimehifadhiwa.',
    stack: 'Chatgram kwa Android · Windows · wavuti',
  },
};
