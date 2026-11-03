/**
 * Kiswahili long-form pages: about, is-chatgram-free, whats-new, privacy-and-safety.
 * Served by client/landing at /sw/about.html etc. Plain ESM, no imports.
 */
export const PAGES = {
  about: {
    slug: 'about',
    title: 'Kuhusu Chatgram: programu ya bure ya ujumbe',
    description:
      'Chatgram ni programu ya bure ya ujumbe iliyotengenezwa Rwanda kwa Android, Windows na wavuti, yenye gumzo, hali, simu na Chatgram AI.',
    h1: 'Chatgram ni nini, na ni kwa nani?',
    updated: '3 Novemba 2026',
    intro:
      'Chatgram ni programu ya ujumbe iliyotengenezwa Rwanda kwa ajili ya watu wanaotaka gumzo rahisi kwenye simu, kompyuta na kivinjari. Ina gumzo la mtu mmoja na vikundi, hali ya saa 24, ujumbe wa sauti, simu za sauti na video, na Chatgram AI. Akaunti moja inatosha kwenye vifaa vyote, na programu inapatikana kwa Kiswahili, Kiingereza, Kinyarwanda na Kifaransa. Ukurasa huu unaeleza inafanya nini leo, na wapi bado kuna kazi.',
    sections: [
      {
        h2: 'Chatgram ni nini?',
        html:
          '<p>Chatgram ni programu ya ujumbe ya bure inayotengenezwa Rwanda. Inafanya kazi kwenye <strong>Android</strong>, <strong>Windows</strong> na kivinjari cha kisasa kupitia <a href="/web/">programu ya wavuti</a>. Kwenye wavuti hakuna cha kusakinisha: fungua ukurasa, ingia, na uanze kutumia.</p>' +
          '<p>Programu zote tatu zinatumia akaunti moja. Ingia kwa barua pepe ile ile kwenye simu, kompyuta na kivinjari, na mazungumzo, anwani pamoja na mipangilio yako hufuata. Hakuna akaunti tofauti kwa kila kifaa.</p>' +
          '<p>Chatgram si bidhaa ya matangazo: hakuna matangazo, usajili, ununuzi wa ndani ya programu wala toleo la malipo. Tovuti hii inaeleza kinachofanya kazi leo na kinachobado, bila kupamba ukweli; kila ukurasa unaonyesha tarehe ya mwisho ya kusasishwa.</p>',
      },
      {
        h2: 'Lugha nne na vifaa vitatu',
        html:
          '<p>Kiolesura kinapatikana kwa <strong>Kiswahili</strong>, <strong>Kiingereza</strong>, <strong>Kinyarwanda</strong> na <strong>Kifaransa</strong>. Unaweza kubadilisha lugha wakati wowote bila kupoteza mazungumzo, kwa sababu lugha ni ya kiolesura tu.</p>' +
          '<p>Chatgram AI pia inazungumza lugha hizo nne. Uliza swali kwa Kiswahili kwenye gumzo la AI, au mtaje <strong>@Chatgram AI</strong> ndani ya kikundi ili ajibu kwa niaba ya kila mtu. Majibu huchakatwa na mtoa huduma wa AI wa mtu mwingine na yanaweza kuwa na makosa, kwa hiyo yapime kabla ya kuyatumia.</p>',
      },
      {
        h2: 'Kinachofanya kazi leo',
        html:
          '<ul>' +
          '<li>Gumzo la mtu mmoja na vikundi.</li>' +
          '<li>Hali ya saa 24 zinazotoweka zenyewe.</li>' +
          '<li>Ujumbe wa sauti wenye mawimbi, kusitisha, kufuli, kufuta kwa kutelezesha na kasi ya 1.5x au 2x.</li>' +
          '<li>Majibu na mazungumzo yaliyonukuliwa.</li>' +
          '<li>Simu za sauti na video: hadi watu 12 kwenye simu ya kikundi, video kwa 6 wa kwanza.</li>' +
          '<li>Arifa za Android kupitia Firebase Cloud Messaging, na arifa za tray kwenye Windows.</li>' +
          '<li>Mandhari nyeusi na lugha nne za kiolesura.</li>' +
          '</ul>' +
          '<p>Vipengele hivi vinafanya kazi kwenye matoleo ya sasa; hakuna kipengele kinachosubiri “kesho” kwenye ukurasa huu.</p>',
      },
      {
        h2: 'Kinachobado kwa sasa',
        html:
          '<p>Kwa uwazi: ujumbe umesimbwa unaposafiri kwa HTTPS na WSS, lakini huhifadhiwa kwenye seva yetu, hivyo seva inaweza kuusoma. <strong>Usimbaji fiche kutoka mwisho hadi mwisho haujatekelezwa bado</strong>, na hatudai vinginevyo.</p>' +
          '<p>Programu ya Windows haijatiwa sahihi, kwa hiyo SmartScreen inaweza kuonya mara ya kwanza; chagua “Maelezo zaidi” kisha “Endesha hata hivyo”. Programu ya Android inasakinishwa moja kwa moja kutoka faili ya APK, si kupitia Google Play. Chatgram AI inaweza kukosea.</p>',
      },
      {
        h2: 'Chatgram ni kwa ajili ya nani?',
        html:
          '<p>Chatgram ni kwa mtu anayetaka gumzo rahisi na la bure kwenye simu na kompyuta, kwa familia inayotumia vikundi, na kwa watu wanaotumia Kiswahili, Kinyarwanda, Kifaransa au Kiingereza kila siku.</p>' +
          '<p>Ikiwa unahitaji usimbaji fiche kutoka mwisho hadi mwisho kwa faragha kamili, Chatgram haitoshelezi bado; tunaandika hilo waziwazi kwenye <a href="/guides/how-to-use-chatgram.html">mwongozo wa kutumia Chatgram</a>.</p>' +
          '<p>Anza kwa <a href="/downloads/chatgram-android.apk">pakua APK ya Android</a>, au fungua <a href="/web/">programu ya wavuti</a> kwenye kivinjari. Hatua za kina ziko kwenye <a href="/guides/chatgram-android-download-install.html">mwongozo wa Android</a> na <a href="/guides/chatgram-windows-download-smartscreen.html">mwongozo wa Windows</a>.</p>',
      },
    ],
    faq: [
      {
        q: 'Chatgram ni bure?',
        a: 'Ndiyo. Chatgram ni bure kwa Android, Windows na wavuti. Hakuna matangazo, usajili, ununuzi ndani ya programu wala toleo la malipo. Hakuna kitu unachohitaji kulipa ili kutuma ujumbe, kupiga simu au kutumia Chatgram AI; hii ni pamoja na simu na Chatgram AI.',
      },
      {
        q: 'Nahitaji akaunti tofauti kwa kila kifaa?',
        a: 'Hapana. Akaunti moja inafanya kazi kwenye vifaa vyote. Ingia kwa barua pepe ile ile kwenye Android, Windows na kivinjari, na mazungumzo yako yatakuwa tayari. Hakuna usanidi wa ziada kwa kila kifaa.',
      },
      {
        q: 'Chatgram inapatikana wapi?',
        a: 'Kwenye tovuti hii: APK ya Android iko kwenye sehemu ya Vipakuliwa, programu ya Windows inapatikana kwa usakinishaji, na wavuti inafunguka moja kwa moja kwenye kivinjari. Android bado haiko Google Play, na programu ya Windows haijatiwa sahihi. Ukurasa wa Vipakuliwa unaonyesha toleo, ukubwa na SHA-256.',
      },
    ],
  },

  'is-chatgram-free': {
    slug: 'is-chatgram-free',
    title: 'Chatgram ni bure: hakuna matangazo wala malipo',
    description:
      'Chatgram ni bure kwenye Android, Windows na wavuti: hakuna matangazo, usajili, ununuzi ndani ya programu wala toleo la malipo.',
    h1: 'Bei ya Chatgram: bure, bila mianya ya malipo',
    updated: '3 Novemba 2026',
    intro:
      'Swali la kwanza ambalo watu wengi huuliza ni moja: Chatgram ni bure? Jibu ni ndiyo, na ukurasa huu unaeleza maana yake kwa vitendo. Hutalipa ili kutuma ujumbe, kupiga simu, kutazama hali au kutumia Chatgram AI. Hakuna matangazo yanayoingizwa kwenye gumzo, hakuna usajili wa mwezi, na hakuna toleo la malipo linaloficha vipengele.',
    sections: [
      {
        h2: 'Jibu fupi: ndiyo, ni bure',
        html:
          '<p>Chatgram ni bure kwenye majukwaa yote matatu: <strong>Android</strong>, <strong>Windows</strong> na wavuti. Hakuna kulipa ili kupakua, kusakinisha au kutumia vipengele vilivyopo. Akaunti moja inatosha kwenye vifaa vyote, na hakuna kikomo cha muda kinachohitaji malipo.</p>' +
          '<p>Hakuna usajili wa mwezi, hakuna ununuzi ndani ya programu, na hakuna toleo la malipo linaloficha ujumbe wa sauti, simu au Chatgram AI. Vipengele vinavyoelezwa kwenye tovuti hii ni vya toleo la kawaida.</p>',
      },
      {
        h2: 'Hakuna matangazo kwenye gumzo',
        html:
          '<p>Chatgram haina matangazo. Hupati matangazo yanayoingia kati ya ujumbe wako, na hakuna sehemu ya gumzo inayotengwa kwa ajili ya matangazo. Programu hii haijengwa kwa mapato ya matangazo, kwa hiyo hakuna sababu ya kuweka matangazo ili programu iendelee.</p>' +
          '<p>Hii inamaanisha hakuna “toleo la bure lenye matangazo” na “toleo la malipo lisilo na matangazo”: kuna toleo moja, na ni la bure. Matangazo hayo hayapo kwenye gumzo, kwenye orodha ya mazungumzo au kwenye skrini ya kwanza.</p>',
      },
      {
        h2: 'APK ya Android: bure, moja kwa moja',
        html:
          '<p>Programu ya Android ni toleo <strong>1.1.7</strong> na inahitaji Android 7.0 au mpya zaidi. Unaipakua kama faili ya APK kutoka <a href="/downloads/chatgram-android.apk">sehemu ya Vipakuliwa</a> na kuisakinisha mwenyewe; bado haiko Google Play.</p>' +
          '<p>Kwa sababu ni usakinishaji wa moja kwa moja, Android inaweza kuomba idhini ya “Sakinisha programu zisizojulikana”. Hakuna malipo yoyote kwenye hatua hiyo, na ukubwa wa faili pamoja na SHA-256 vinaonyeshwa kwenye ukurasa wa Vipakuliwa. APK hii ni toleo kamili: hakuna toleo la “lite” linalohitaji malipo ili kuongeza vipengele.</p>',
      },
      {
        h2: 'Programu ya Windows: bure, lakini haijatiwa sahihi',
        html:
          '<p>Programu ya Windows ni toleo <strong>1.1.6</strong> kwa Windows 10 au mpya zaidi, 64-bit. Programu ya usakinishaji inapatikana bila malipo kupitia ukurasa wa Vipakuliwa, na inajisakinisha kama programu ya kawaida. Ukubwa wa faili ni 86,263,690 baiti, na thamani kamili inaonyeshwa kwenye kadi ya upakuaji pamoja na SHA-256.</p>' +
          '<p>Kwa sababu haijatiwa sahihi, Windows SmartScreen inaweza kuonya mara ya kwanza. Chagua “Maelezo zaidi” kisha “Endesha hata hivyo”. Onyo hilo linahusu sahihi ya programu, si malipo: hakuna malipo yoyote.</p>' +
          '<p>Kabla ya kusakinisha, linganisha SHA-256 iliyochapishwa kwenye ukurasa wa Vipakuliwa na faili uliyopakua. Mwongozo wa <a href="/guides/chatgram-windows-download-smartscreen.html">Windows na SmartScreen</a> una hatua kamili.</p>',
      },
      {
        h2: 'Bure haimaanishi nini',
        html:
          '<p>Bure haimaanishi kuwa kila kitu kinachotajwa kwenye tovuti hii kitakuwepo milele bila mabadiliko: hatutangazi bei ya baadaye wala vipengele vya baadaye. Hii ni hali ya leo, si ahadi ya barabara ya miaka ijayo.</p>' +
          '<p>Pia haimaanishi usimbaji fiche kutoka mwisho hadi mwisho: ujumbe umesimbwa unaposafiri na huhifadhiwa kwenye seva, hivyo seva inaweza kuusoma. Chatgram AI hutumia mtoa huduma wa AI wa mtu mwingine na inaweza kukosea. Bure hakuondoi vikwazo hivyo.</p>' +
          '<p>Na haimaanishi msaada wa dharura au uhakika wa huduma: ni programu ya bure inayotengenezwa na timu ndogo, na matengenezo hufanywa kadri ya uwezo. Chatgram haijawekwa kwenye Google Play, hivyo usakinishaji wa Android unafanyika kwa APK; hilo ni jambo la usambazaji, si la malipo.</p>',
      },
    ],
    faq: [
      {
        q: 'Chatgram ni bure kwa kweli?',
        a: 'Ndiyo. Hakuna malipo ya kupakua, kusakinisha au kutumia. Hakuna matangazo, usajili, ununuzi ndani ya programu wala toleo la malipo. Vipengele vyote vinavyoelezwa kwenye tovuti hii ni vya toleo la kawaida la bure.',
      },
      {
        q: 'Kuna gharama zilizofichwa?',
        a: 'Hakuna. Hutalipi kwa ujumbe, simu, hali au Chatgram AI. Programu ya Windows na APK ya Android zinapatikana bure, na wavuti haina usakinishaji. Tumia tu viungo vya ukurasa huu wa Vipakuliwa badala ya tovuti nyingine; kadi za upakuaji zinaonyesha toleo, ukubwa na SHA-256 ili uweze kuthibitisha faili.',
      },
      {
        q: 'Kwa nini Chatgram ni bure?',
        a: 'Chatgram inatengenezwa na timu ndogo nchini Rwanda na haijengwa kwa mapato ya matangazo. Kwa sasa programu inatolewa bure bila matangazo, usajili au toleo la malipo, na hatutangazi bei au vipengele vya baadaye. Hakuna malipo yanayotakiwa kwa kutumia vipengele vilivyoelezwa kwenye tovuti hii.',
      },
    ],
  },

  'whats-new': {
    slug: 'whats-new',
    title: 'Chatgram: maelezo ya matoleo mapya ya 2026',
    description:
      'Mabadiliko ya 2026 kwenye Chatgram: arifa za Android zikiwa zimefungwa, ujumbe wa sauti wenye mawimbi, majibu, mandhari na udhibiti wa skrini.',
    h1: 'Nini kipya kwenye Chatgram, jukwaa kwa jukwaa',
    updated: '3 Novemba 2026',
    intro:
      'Mwaka 2026 ulileta mabadiliko kadhaa kwenye Chatgram, jukwaa kwa jukwaa. Ukurasa huu ni orodha ya mambo yaliyowasili na maana yake kwako: arifa za ujumbe na simu zinazokufikia hata programu ikiwa imefungwa, ujumbe wa sauti wenye vidhibiti kamili, na maboresho ya mipangilio pamoja na usalama wa akaunti. Toleo la Android ni 1.1.7, la Windows ni 1.1.6, na programu ya wavuti ni 1.1.3. Mabadiliko haya yote ni ya mwaka 2026.',
    sections: [
      {
        h2: 'Android 1.1.7: arifa zinazokufikia',
        html:
          '<p>Arifa za push sasa zinafika kupitia Firebase Cloud Messaging. Ujumbe na simu hukuifikia hata Chatgram ikiwa imefungwa au iko nyuma ya pazia, badala ya kusubiri hadi ufungue programu.</p>' +
          '<p>Hii inamaanisha ujumbe muhimu unaweza kukufikia ukiwa mbali na simu, bila kusubiri ufungue programu. Toleo hili linahitaji Android 7.0 au mpya zaidi.</p>' +
          '<p>Arifa hizi husaidia ukiwa mbali na simu au ukiwa umeifunga programu kwa muda.</p>',
      },
      {
        h2: 'Ujumbe wa sauti wenye vidhibiti kamili',
        html:
          '<p>Ujumbe wa sauti ulipata vidhibiti vinavyotumika kila siku: kutelezesha ili kufuta, kufuli ya kurekodi bila kuachia kitufe, kusitisha na kuendelea, mawimbi yanayoonyesha urefu halisi, na kasi ya kucheza 1.5x au 2x.</p>' +
          '<p>Mawimbi hukusaidia kuruka sehemu isiyo na maana, na kasi mbili hurahisisha kusikiliza ujumbe mrefu. Ujumbe wa sauti unaonekana kwenye gumzo kama kawaida, ukiwa na muda wake. Kwa hiyo unaweza kurekodi ujumbe mrefu bila kuendelea kushika kitufe, na kuusikiliza kwa kasi ukiwa na muda mchache.</p>',
      },
      {
        h2: 'Majibu, mandhari na mipangilio',
        html:
          '<p>Majibu ya ujumbe yameboreshwa: unaweza kujibu ujumbe mmoja kwa kadi inayoonyesha maandishi yaliyonukuliwa, na kufuata mazungumzo bila kuchanganyikiwa.</p>' +
          '<p>Mandhari za ukuta zinaweza kuwekwa kwenye gumzo moja au kwenye programu yote. Mipangilio imejengwa upya kama orodha ya WhatsApp, ikiwa na kurasa maalum kwa kila kundi la mipangilio, ili upate kitu kimoja kwa haraka badala ya kuteleza kupita mipangilio isiyohitajika.</p>',
      },
      {
        h2: 'Windows 1.1.6: kompyuta yako inaunganishwa',
        html:
          '<p>Programu ya Windows inaonyesha arifa za tray, hivyo ujumbe unaokufikia wakati dirisha limefungwa haupotei. Unaweza kudhibiti skrini ya kompyuta kwa mbali kutoka kwenye programu ya Windows wakati wa simu, ikiwa wahusika wamekubali.</p>' +
          '<p>Ubora wa kushiriki skrini umeboreshwa. Toleo hili ni 1.1.6 na linahitaji Windows 10 au mpya zaidi, 64-bit.</p>',
      },
      {
        h2: 'Wavuti 1.1.3: hakuna usakinishaji',
        html:
          '<p>Programu ya wavuti ni toleo <strong>1.1.3</strong> na haihitaji usakinishaji. Fungua <a href="/web/">programu ya wavuti</a> kwenye kivinjari cha kisasa na uingie kwa akaunti ile ile unayotumia kwenye simu au kompyuta; mazungumzo yako yatakuwa pale pale.</p>' +
          '<p>Hii ni njia rahisi ya kuanza ukiwa kwenye kompyuta mpya, na hakuna faili ya kupakua.</p>',
      },
      {
        h2: 'Usalama, msaada na akaunti',
        html:
          '<p>Kufuta akaunti sasa kumelindwa: unahitaji nenosiri lako pamoja na msimbo uliotumwa kwa barua pepe, kisha kuna kipindi cha siku 14 cha kughairi kabla akaunti haijafutwa kabisa.</p>' +
          '<p>Ripoti za Msaada sasa zinaunda masuala kwenye GitHub, hivyo timu inaweza kufuatilia hitilafu mahali pamoja badala ya kuzipoteza kwenye ujumbe. Hii ni sehemu ya maboresho ya 2026 kwenye matoleo ya Android na Windows.</p>' +
          '<p>Kinachobado: usimbaji fiche kutoka mwisho hadi mwisho haujatekelezwa bado, programu ya Windows haijatiwa sahihi, na Android inasakinishwa moja kwa moja. Tutasema mabadiliko yanapowasili, si kabla. Mabadiliko yaliyoorodheshwa hapa ni halisi kwenye matoleo yaliyotajwa; hatuorodheshi kitu ambacho hakijawasili.</p>',
      },
    ],
    faq: [
      {
        q: 'Ninasasisha vipi programu ya Android?',
        a: 'Pakua APK ya sasa kutoka sehemu ya Vipakuliwa, ifungue, kisha ruhusu “Sakinisha programu zisizojulikana” kwa kivinjari chako au programu ya Faili inapouliza. Chatgram 1.1.7 inahitaji Android 7.0 au mpya zaidi, na bado haiko Google Play. Ukurasa wa Vipakuliwa unaonyesha toleo la sasa.',
      },
      {
        q: 'Arifa hufanya kazi Chatgram ikiwa imefungwa?',
        a: 'Kwenye Android 1.1.7 na matoleo mapya zaidi, ndiyo: ujumbe na simu hufika kupitia Firebase Cloud Messaging hata programu ikiwa imefungwa au iko nyuma ya pazia. Kwenye Windows, programu inaonyesha arifa za tray ikiwa inafanya kazi. Jukwaa la wavuti halihitaji usakinishaji. Hii ni sehemu ya toleo la Android 1.1.7.',
      },
      {
        q: 'Programu ya Windows inajisasisha vipi?',
        a: 'Pakua programu ya usakinishaji kutoka sehemu ya Vipakuliwa ya tovuti hii na uendeshe. Programu ya Windows ni 1.1.6 kwa Windows 10 au mpya zaidi, 64-bit. Kwa sababu haijatiwa sahihi, SmartScreen inaweza kuonya: chagua “Maelezo zaidi” kisha “Endesha hata hivyo”.',
      },
    ],
  },

  'privacy-and-safety': {
    slug: 'privacy-and-safety',
    title: 'Chatgram: faragha na usalama ulivyo kweli',
    description:
      'Chatgram inalinda ujumbe ukiwa safarini kwa TLS, ina nenosiri la akaunti, kuzuia na kuripoti, na kufuta akaunti kwa kipindi cha siku 14.',
    h1: 'Chatgram inalinda nini, na nini bado hakifanyiki',
    updated: '3 Novemba 2026',
    intro:
      'Faragha ni mada ambayo ni rahisi kupamba. Ukurasa huu unaeleza kwa uwazi kinacholindwa leo, kinachobado, na jinsi ya kutumia Chatgram kwa usalama. Hutapata hapa ahadi ya usimbaji fiche kutoka mwisho hadi mwisho, kwa sababu haujatekelezwa bado. Utapata badala yake maelezo ya TLS, nenosiri la akaunti, kuzuia na kuripoti, kufuta akaunti kwa kipindi cha neema, na jinsi ya kuthibitisha vipakuliwa.',
    sections: [
      {
        h2: 'Kinacholindwa: ujumbe ukiwa safarini',
        html:
          '<p>Kila ombi na kila muunganisho wa Chatgram hupitia HTTPS na WSS kwa cheti halali cha TLS. Hii inamaanisha ujumbe hausomwi kirahisi na mtu aliye katikati ya mtandao wako, kama vile Wi-Fi ya umma isiyo salama.</p>' +
          '<p>Lakini TLS inalinda ujumbe <em>unaposafiri</em> tu. Baada ya kufika seva, ujumbe huhifadhiwa ili uweze kuusoma kwenye kifaa kingine. Hilo ni jambo la muhimu la kuelewa, na tunalieleza wazi.</p>',
      },
      {
        h2: 'Akaunti yako: nenosiri na kifaa',
        html:
          '<p>Akaunti yako inalindwa kwa nenosiri. Tumia nenosiri refu na la kipekee ambalo hutumii kwenye tovuti nyingine, na usilishe mtu yeyote. Kuingia kwako kunaweza kuwa kwenye simu, kompyuta na kivinjari kwa wakati mmoja. Nenosiri moja lililoibiwa mahali pengine halipaswi kufungua akaunti yako yote.</p>' +
          '<p>Kama kifaa kimepotea au umeacha kuingia mahali usipoamini, badilisha nenosiri mara moja. Usitumie nenosiri moja kwenye akaunti nyingi.</p>',
      },
      {
        h2: 'Kinachobado: seva inaweza kusoma ujumbe',
        html:
          '<p><strong>Usimbaji fiche kutoka mwisho hadi mwisho haujatekelezwa bado.</strong> Ujumbe umesimbwa unaposafiri na huhifadhiwa kwenye seva, kwa hiyo seva inaweza kuusoma. Hatudai faragha ambayo haipo.</p>' +
          '<p>Hii ni muhimu kwa mtu anayehitaji faragha kamili: kwa sasa Chatgram haitoshelezi mahitaji hayo. Hilo linamaanisha faragha kamili haipo bado kwa ujumbe uliohifadhiwa. Tunaeleza kikwazo hiki kwenye ukurasa wa <a href="/docs/">masharti na faragha</a> pia, badala ya kukificha.</p>',
      },
      {
        h2: 'Pakua kwa usalama: thibitisha faili',
        html:
          '<p>Pakua APK ya Android na programu ya Windows kutoka sehemu ya Vipakuliwa ya tovuti hii tu, na linganisha SHA-256 iliyochapishwa na faili uliyopakua kabla ya kusakinisha. Checksum hutambulisha faili iliyochapishwa; ikiwa thamani hailingani, usisakinishe. Kwenye Windows, tumia <em>Get-FileHash</em> kuhesabu SHA-256 ya faili na uilinganishe na ile iliyochapishwa.</p>' +
          '<p>APK ya Android ni toleo 1.1.7, inahitaji Android 7.0 au mpya zaidi, na bado haiko Google Play. Programu ya Windows ni 1.1.6 kwa Windows 10 au mpya zaidi, 64-bit.</p>' +
          '<p>Programu ya Windows haijatiwa sahihi, kwa hiyo SmartScreen inaweza kuonya: chagua “Maelezo zaidi” kisha “Endesha hata hivyo” ikiwa umeipakua kutoka chanzo rasmi. APK ya Android inasakinishwa moja kwa moja, hivyo Android itaomba idhini ya “Sakinisha programu zisizojulikana”.</p>',
      },
      {
        h2: 'Ripoti, zuia na kufuta akaunti',
        html:
          '<p>Unaweza kumzuia mtu asikatumie ujumbe au kukupigia simu, na kuripoti maudhui kwa njia ya Msaada. Ripoti zinaunda masuala kwenye GitHub ili timu izifuatilie badala ya kupotea kwenye gumzo la mtu mmoja.</p>' +
          '<p>Kufuta akaunti kunahitaji nenosiri lako pamoja na msimbo unaotumwa kwa barua pepe. Baada ya ombi, kuna kipindi cha siku 14 cha kughairi kabla ya kufutwa kabisa. Hii inalinda dhidi ya kufuta kwa bahati mbaya au kwa mtu aliyepata kifaa chako.</p>',
      },
    ],
    faq: [
      {
        q: 'Je, ujumbe wangu umesimbwa kutoka mwisho hadi mwisho?',
        a: 'Bado. Ujumbe umesimbwa unaposafiri kwa HTTPS na WSS, lakini huhifadhiwa kwenye seva, hivyo seva inaweza kuusoma. Usimbaji fiche kutoka mwisho hadi mwisho haujatekelezwa bado, na hatudai kwamba unafanya kazi. Hii inamaanisha seva inaweza kuusoma ujumbe uliohifadhiwa, na ni tofauti muhimu kwa mazungumzo nyeti.',
      },
      {
        q: 'Ninawezaje kulinda akaunti yangu?',
        a: 'Tumia nenosiri refu na la kipekee ambalo hutumii kwenye huduma nyingine, na usilishe mtu yeyote. Ukihisi kifaa kimepotea au akaunti imeingiwa, badilisha nenosiri mara moja. Hii ni muhimu hasa kwenye vifaa vinavyoshirikiwa, na usitumie nenosiri moja kwenye akaunti nyingi.',
      },
      {
        q: 'Naweza kufuta akaunti yangu?',
        a: 'Ndiyo. Kufuta akaunti kunahitaji nenosiri lako pamoja na msimbo unaotumwa kwa barua pepe. Kisha kuna kipindi cha siku 14 cha kughairi kabla akaunti haijafutwa kabisa, ili kufuta kwa bahati mbaya kusiwe na madhara ya kudumu. Hii ndiyo njia ya kufuta akaunti kwa hiari, na kipindi hicho kinakupa nafasi ya kubadilisha mawazo.',
      },
      {
        q: 'Nithibitishe vipi faili nilizopakua?',
        a: 'Linganisha SHA-256 iliyochapishwa kwenye ukurasa wa Vipakuliwa na thamani ya faili uliyopakua. Kwenye Windows unaweza kutumia Get-FileHash; ikiwa thamani hailingani, faili si ile rasmi na haipaswi kusakinishwa. Faili isiyolingana na checksum haipaswi kusakinishwa; tumia tu kiungo cha ukurasa huu wa Vipakuliwa.',
      },
    ],
  },
};
