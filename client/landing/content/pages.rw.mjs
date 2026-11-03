/**
 * Long-form SEO pages in Kinyarwanda.
 *
 * Served by the `client/landing` static build. Wording follows
 * `landing.rw.mjs` (same vocabulary, spelling and register). Facts are limited
 * to `docs/reports/seo-content-brief.md`; internal links only.
 */
export const PAGES = {
  about: {
    slug: 'about',
    title: 'Ku byerekeye Chatgram: ubutumwa ku buntu',
    description:
      "Chatgram ni porogaramu y'ubujumbe yubakiwe mu Rwanda, ikora kuri Android, Windows no ku rubuga, mu ndimi enye, ku buntu.",
    h1: "Chatgram ni porogaramu y'ubujumbe yubakiwe mu Rwanda",
    updated: '3 Ugushyingo 2026',
    intro:
      "Chatgram ni porogaramu y'ubujumbe ku buntu yubakiwe mu Rwanda. Ikora kuri Android, Windows no ku rubuga, kandi konti imwe iragukura ku bikoresho byose. Ushobora kuganira n'abantu n'itsinda, kohereza ubutumwa bw'amajwi, usangiza status y'amasaha 24, uhamagare mu majwi cyangwa mu mashusho, kandi ukoreshe Chatgram AI mu ndimi enye. Iyi paji isobanura ibikora ubu, ibitarakorwa, n'ibisabwa kugira ngo utangire ukoreshe Chatgram.",
    sections: [
      {
        h2: 'Chatgram ni iki?',
        html: `<p>Chatgram ni porogaramu y'ubujumbe yagenewe guhuza abantu mu buryo bworoshye kandi bwa hafi. Mu kiganiro cy'umuntu umwe cyangwa mu itsinda, ushobora kohereza ubutumwa bwo mu nyandiko, amafoto, amashusho n'amajwi, kandi ugakurikirana ibimenyetso byo kugeza no gusoma. Hari kandi ubutumwa bw'amajwi bufite waveform n'umuvuduko wo gukina, status y'amasaha 24, n'uhamagara mu majwi no mu mashusho.</p>
<p>Chatgram AI ni ikiganiro gisanzwe kiri mu rutonde rw'ibiganiro. Mu itsinda ushobora kuvuga @Chatgram AI kugira ngo ubaze ikibazo, ariko ibisubizo bitangwa na serivisi ya AI y'undi muryango, bityo bishobora kwibeshya.</p>
<p>Mu by'ukuri, konti imwe ikoreshwa kuri byose uko ari bitatu, bityo ntushobora gutakaza ibiganiro iyo wahinduye igikoresho. Ubutumwa bugera ako kanya, kandi ibimenyetso byo kugeza no gusoma bikwereka uko ubutumwa bwageze ku wundi.</p>`,
      },
      {
        h2: "Ku bikoresho bitatu: Android, Windows n'urubuga",
        html: `<p>Konti imwe ikora kuri byose uko ari bitatu, bityo ntukeneye kwiyandikisha kabiri cyangwa gutakaza ibiganiro iyo wahinduye igikoresho.</p>
<ul>
<li><strong>Android 1.1.7:</strong> APK ifite 1,589,034 bytes, isaba Android 7.0 (API 24) cyangwa hejuru. Uyikura kuri <a href="/downloads/chatgram-android.apk">urupapuro rwo gukurura</a>; ntabwo iri muri Google Play ubu.</li>
<li><strong>Windows 1.1.6:</strong> porogaramu ishyira isaba Windows 10 cyangwa hejuru, 64-bit. Ntirayashyiriweho umukono, bityo SmartScreen ishobora kukuburira; reba <a href="/guides/chatgram-windows-download-smartscreen.html">umwongozo wa SmartScreen</a>.</li>
<li><strong>Urubuga 1.1.3:</strong> nta kintu cyo gushyira; fungura <a href="/web/">urubuga rwa Chatgram</a> mu mushakishamakuru wawe.</li>
</ul>
<p>Verisiyo za Android na Windows zitandukanye, bityo reba verisiyo iri ku rupapuro rwo gukurura mbere yo gushyira. Niba utazi uko wakura cyangwa gushyira, amayoborwa arambuye ari ku mbuga za /guides/.</p>`,
      },
      {
        h2: "Indimi enye n'ibikoresho bya buri munsi",
        html: `<p>Chatgram iboneka mu Kinyarwanda, Icyongereza, Igifaransa n'Ikiswahili, kandi Chatgram AI isubiza mu ndimi izo enye. Ibikoresho birimo ubutumwa bw'amajwi, gusubiza no guhindura ubutumwa, inyenyeri, gushakisha, amafoto n'amashusho, chat wallpapers, n'igenamiterere ryoroshye rifite paji zihariye. Hari kandi ibara ryirabura, gusohora sesiyo, n'ibimenyetso byo gusoma bishobora kuzimwa. Kuri Android, kumenyesha bigera binyuze mu Firebase Cloud Messaging; kuri Windows, porogaramu yerekana ubutumwa muri tray.</p>
<p>Indimi enye zifasha gukoresha Chatgram mu rurimi utegera, aho kwiga indi; ibikoresho byose birahari muri izo ndimi. Ibi bifasha kandi abantu bakoresha porogaramu ku gikoresho kimwe mu rugo rwabo.</p>`,
      },
      {
        h2: "Ibikora ubu n'ibitarakorwa",
        html: `<p>Ibyinshi bikora ubu: ibiganiro by'umuntu umwe n'iby'amatsinda, ubutumwa bw'amajwi, status, uhamagara, Chatgram AI, n'igenamiterere. Ariko hari ibitarakorwa, kandi ni byiza kubimenya mbere: ubutumwa ntibushyirwa mu banga kuva ku wohereje kugera ku wakiriye. Bushensete kuri seriveri, bityo seriveri ibasha kubusoma. Porogaramu ya Windows ntirayashyiriweho umukono, na APK ishyirwa nta Play Store. Chatgram AI ishobora kwibeshya. Ibi bivugwa mu buryo bwuzuye ku <a href="/docs/">paji y'amategeko n'ibanga</a>.</p>
<p>Kumenya iyi mipaka ni byiza mbere yo kohereza amakuru y'ibanga cyane. Ni uko ibintu bimeze ubu, ntabwo ari ibintu byahishe; tubivuga kugira ngo utegure neza icyo watangaza.</p>`,
      },
      {
        h2: "Gutangira, konti imwe n'ubufasha",
        html: `<p>Fungura konti yawe ukoresheje email cyangwa Google, hanyuma ukurure porogaramu cyangwa ukoreshe urubuga. Konti imwe irakora kuri byose uko ari bitatu, bityo ibiganiro byawe biboneka aho wagiye. Amayoborwa arambuye ari ku mbuga za /guides/: uko wakoresha Chatgram, uko wakurura no gushyira kuri Android, n'uko wakemura ikibazo cya SmartScreen kuri Windows. Niba ufite ikibazo, reba <a href="/guides/how-to-use-chatgram.html">umwongozo w'uko wakoresha Chatgram</a> cyangwa ukoreshe Chatgram AI mu porogaramu.</p>
<p>Niba utabona igisubizo, baza ikibazo mu bufasha buri mu porogaramu; raporo zihinduka GitHub issues kandi abayobozi bazisubiza. Ntukeneye kwishyura kugira ngo ubone ubufasha.</p>`,
      },
    ],
    faq: [
      {
        q: 'Chatgram ni ubuntu?',
        a: "Yego. Nta kwamamaza, nta kwiyandikisha, nta kugura ibintu imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. Ibikoresho byose biri muri porogaramu ubu urabibona ku buntu, ariko ntitwemeza ko ibintu bizahinduka ejo; iki ni igisubizo ku byo ubu.",
      },
      {
        q: 'Nkeneye konti yihariye kuri buri gikoresho?',
        a: "Oya. Konti imwe ikora kuri Android, Windows no ku rubuga. Injira n'email imwe ku bikoresho byose, kandi ibiganiro byawe bizaba bihari aho wagiye. Nta mpamvu yo kwiyandikisha kabiri cyangwa kwishyura konti ya kabiri.",
      },
      {
        q: "Chatgram ikora ku bihe by'ibikoresho?",
        a: "Kuri Android isaba verisiyo 7.0 (API 24) cyangwa hejuru; kuri Windows isaba Windows 10 cyangwa hejuru, 64-bit; ku rubuga ikoreshwa mu mushakishamakuru usanzwe. Nta gikoresho cyihariye kigenewe, kandi konti imwe ikora kuri byose uko ari bitatu.",
      },
    ],
  },

  'is-chatgram-free': {
    slug: 'is-chatgram-free',
    title: 'Chatgram ni ubuntu: nta amafaranga, nta kwamamaza',
    description:
      "Chatgram ni ubuntu rwose: nta kwamamaza, nta kwiyandikisha, nta kugura imbere mu porogaramu, kandi nta verisiyo y'ubwishyu.",
    h1: "Igiciro cya Chatgram: ubuntu, nta amafaranga yihishe",
    updated: '3 Ugushyingo 2026',
    intro:
      "Chatgram ni ubuntu, kandi ibyo ntibisobanura gusa ko ushobora kuyikoresha nta kwishyura: ntihariho kwamamaza, nta kwiyandikisha, nta kugura ibintu imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. Iyi paji isubiza ikibazo cy'igiciro mu buryo bwuzuye, ivuga aho APK na porogaramu ishyira biva, n'ibyo “ubuntu” bitavuga. Nta mafaranga akenewe kugira ngo ukoreshe Chatgram ubu. Iyi paji kandi ikwereka uko wamenya ko ukura porogaramu y'ukuri.",
    sections: [
      {
        h2: 'Igiciro ni ubu: ni ubuntu',
        html: `<p>Chatgram ni ubuntu kuri Android, Windows no ku rubuga. Nta kwamamaza, nta kwiyandikisha, nta kugura ibintu imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. Ibyo bisobanura ko ibikoresho biri muri porogaramu ubu, nk'ibiganiro, ubutumwa bw'amajwi, status, guhamagara na Chatgram AI, bitagira igiciro cyihariye. Nta gihe ntarengwa, nta fagitire, kandi nta kode y'ubwishyu ukeneye kwinjiza.</p>
<p>Ibi ni ukuri ku bakoresha bose: nta plan yihariye, nta masezerano, kandi nta kintu gikomeye gusaba kwishyura. Ushobora gukoresha ibikoresho byose biri muri porogaramu ubu utabanje kwishyura.</p>`,
      },
      {
        h2: "Aho APK na porogaramu ishyira biva",
        html: `<p>Porogaramu ya Android ikurwa nka APK kuri <a href="/downloads/chatgram-android.apk">urupapuro rwo gukurura</a>. Iri ni ubwubatsi bukururwa ku buryo butaziguye, ntabwo busohotse muri Google Play. Porogaramu ya Windows ikurwa ku rubuga rwa Chatgram nka porogaramu ishyira; ntukeneye kwishyura kugira ngo uyikure cyangwa uyikoreshe. Gukurura no gushyira ntibisaba amafaranga, kandi ubutumwa bwose bwo mu porogaramu ntibugira igiciro. Reba <a href="/guides/chatgram-android-download-install.html">umwongozo wo gushyira kuri Android</a> n'<a href="/guides/chatgram-windows-download-smartscreen.html">umwongozo wa Windows na SmartScreen</a>.</p>
<p>Iyo ukuruye APK cyangwa porogaramu ishyira, nta kode y'ubwishyu ukeneye kwinjiza na nta makuru y'ikarita agomba gutangwa. Niba hari ahandi hasaba amafaranga kugira ngo ubone Chatgram, si urubuga rwemewe.</p>`,
      },
      {
        h2: "Ibyo “ubuntu” bitavuga",
        html: `<p>Kuvuga ko Chatgram ni ubuntu ntibivuga ko tuzahora dutanga ibintu bishya, cyangwa ko ibiciro bizaguma uku ukurikije gahunda y'ibihe bizaza. Iki ni igisubizo ku byo ubu: nta kwamamaza, nta kwiyandikisha, nta kugura imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. “Ubuntu” kandi ntibivuga ko Chatgram itagira imipaka: ubutumwa ntibushyirwa mu banga kuva ku wohereje kugera ku wakiriye, kandi seriveri ibasha kubusoma. Chatgram AI ishobora kwibeshya kuko isubizwa na serivisi y'undi muryango.</p>
<p>Ubuntu ni igiciro, ntabwo ni isezerano ry'ibizaza. Icyo dusobanura ni ibiriho ubu: nta kwamamaza, nta kwiyandikisha, nta kugura imbere mu porogaramu, kandi nta verisiyo y'ubwishyu.</p>`,
      },
      {
        h2: "Ushobora kwirinda uburiganya bw'amafaranga",
        html: `<p>Kurura porogaramu gusa ku mahuriro asohowe ku rubuga rwa Chatgram cyangwa ku rupapuro rwo gukurura rwemejwe. Nta muntu ugomba kukusaba kwishyura kugira ngo ubone konti cyangwa ubone ijambo ry'ibanga. Mbere yo gushyira, gereranya SHA-256 yasohotse n'iyo dosiye yawe, nk'uko bigaragara ku <a href="/downloads/chatgram-android.apk">rupapuro rwa APK</a> n'ahandi ku rubuga. Niba hari ikintu gitunguranye, bibwire ubufasha binyuze mu <a href="/docs/">paji y'amategeko n'ibanga</a> cyangwa mu porogaramu.</p>
<p>Ntukemere ko umuntu uwo ari wese agusaba amafaranga kugira ngo “akwemeze” konti cyangwa akugurire ibikoresho. Tangaza ibintu nk'ibyo binyuze mu bufasha bwo muri porogaramu cyangwa ku <a href="/docs/">paji y'amategeko n'ibanga</a>.</p>`,
      },
      {
        h2: "Konti imwe, ibikoresho bitatu, nta kiguzi",
        html: `<p>Konti imwe ikoreshwa kuri Android, Windows no ku rubuga nta kiguzi cyiyongera ku gikoresho. Urubuga ntirukeneye gushyira, bityo ushobora kubona ibiganiro byawe ukoresheje mushakishamakuru gusa. Guhamagara mu majwi no mu mashusho, ubutumwa bw'amajwi, status na Chatgram AI biri muri porogaramu nta mafaranga yihariye. Ibyo ni byo ubu; ntabwo turangaza ibiciro by'ibihe bizaza.</p>
<p>Ibyo bireba guhamagara, ubutumwa bw'amajwi, status na Chatgram AI: nta kiguzi cyihariye kuri buri kimwe. Ushobora gukoresha konti imwe ku bikoresho bitatu utishyuye kabiri. Iyo ukoresha Chatgram ku rubuga, nta kiguzi cyo kwinjira cyangwa cyo kubona ibiganiro byawe.</p>`,
      },
    ],
    faq: [
      {
        q: 'Ese Chatgram izahora ari ubuntu?',
        a: "Ubu Chatgram ni ubuntu, nta kwamamaza, nta kwiyandikisha, nta kugura imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. Ntabwo twizeza ibizaza, kandi nta gahunda y'ibihe bizaza twatangaje. Icyo dushobora kuvuga ni uko ibiriho ubu ari ubuntu.",
      },
      {
        q: "Hari ikiguzi cyo guhamagara cyangwa Chatgram AI?",
        a: "Oya. Guhamagara mu majwi no mu mashusho, ubutumwa bw'amajwi, status na Chatgram AI biri mu bikoresho bya porogaramu ubu, nta kiguzi cyihariye. Nta verisiyo y'ubwishyu ibaho, kandi nta kintu cyo kugura kugira ngo ubone ibikoresho.",
      },
      {
        q: "Kuki porogaramu ya Windows y'ubuntu ituma SmartScreen iburira?",
        a: "Kubera ko porogaramu ishyira itarashyiriweho umukono, Windows SmartScreen ishobora kukuburira bwa mbere. Hitamo “Andi makuru” hanyuma “Komeza”. Kubura umukono ntibisobanura igiciro cyangwa ibiyirimo; bisobanura gusa ko Windows itaramenya uwagikoze.",
      },
    ],
  },

  'whats-new': {
    slug: 'whats-new',
    title: "Ibishya muri Chatgram: verisiyo nshya n'ibikoresho",
    description:
      "Reba ibyahindutse muri Chatgram mu 2026: ubutumwa bw'amajwi bushya, uhamagara, Chatgram AI, igenamiterere n'ibindi.",
    h1: "Ibyashyizwe muri Chatgram: verisiyo n'ibikoresho bishya",
    updated: '3 Ugushyingo 2026',
    intro:
      "Iyi paji ni urutonde rw'ibyahindutse muri Chatgram mu mwaka wa 2026, rutonde hakurikijwe igikoresho. Verisiyo ziriho ubu ni Android 1.1.7, Windows 1.1.6 na urubuga 1.1.3. Buri gice kivuga icyabashyizwemo n'icyo ibyo bisobanura kuri wowe, nta byo kwiyongera ku byabaye. Ibigice byose ni ibintu byabaye koko muri porogaramu, ntabwo ari gahunda y'ibihe bizaza.",
    sections: [
      {
        h2: "Android 1.1.7: kumenyesha n'iyo porogaramu ifunze",
        html: `<p>Verisiyo ya Android 1.1.7 yasohotse ku wa 27 Ukwakira 2026. Yashyizeho kumenyesha push binyuze mu Firebase Cloud Messaging (FCM): ubutumwa n'uhamagara bigera n'iyo Chatgram ifunze cyangwa iri inyuma. Ibi bisobanura ko utakibura ubutumwa bukomeye kubera ko utarafunguye porogaramu.</p>
<p>Verisiyo imwe yashyizeho kandi ecran yuzuye y'uhamagara winjiye: uhamagara winjiye ukangura ecran n'urupapuro rwose rwa « Emera / Anga », harimo no ku rupapuro rw'ifunguro. Hari n'isuzuma ry'uhamagara riri ku rupapuro rushya, rwandika ubuziranenge bw'umurongo, inzira ya ICE na relay n'impamvu y'ikibazo, kugira ngo uhamagara wacitse cyangwa utagira ijwi ushobore gusuzumwa.</p>`,
      },
      {
        h2: "Android: ubutumwa bw'amajwi yuzuye",
        html: `<p>Ubutumwa bw'amajwi bwarushijeho kuba bworoshye mu kuvuga no mu kuyumva. Ushobora gukanda rimwe utangire; ukurura ibumoso kugira ngo ureke, cyangwa ukurura hejuru kugira ngo ubutumwa bufungwe (lock), bityo ukomeze nta gufata telefoni. Ushobora kubuhagarika, ukabukomeza, hanyuma ukabwohereza.</p>
<p>Ubutumwa bw'amajwi bugaragaza waveform, igihe bwamaze n'uburebure bwabwo, kandi ushobora gukina ku muvuduko wa 1.5 cyangwa 2. Ibi bifasha kumva ubutumwa burambuye mu gihe gito, cyangwa kubyumva neza iyo ari ijwi ryihuse.</p>`,
      },
      {
        h2: 'Android: ibindi byinshi byashyizwemo',
        html: `<p>Hari n'ibindi byinshi byagejejweho kuri Android: ubutumwa bwo gusubiza bufite ikarita y'ubutumwa bwasubijwe, chat wallpapers ku kiganiro kimwe cyangwa kuri porogaramu yose, n'igenamiterere ryongeye kubakwa nk'urutonde rufite paji zihariye kuri buri igenamiterere.</p>
<p>Gusiba konti birindwa kurushaho: bisaba ijambo ry'ibanga n'ikode yoherejwe kuri email, kandi hari igihe cy'iminsi 14 cyo kubihagarika. Ibi bisobanura ko nta muntu ushobora gusiba konti yawe mu buryo buhuse nta kwemeza, kandi ufite igihe cyo guhindura icyemezo.</p>`,
      },
      {
        h2: 'Windows 1.1.6: kugenzura ecran no kugabana neza',
        html: `<p>Kuri Windows, verisiyo 1.1.6 ni yo iriho ubu. Yashyizeho kugenzura ecran ukoresheje porogaramu ya Windows, kandi yongera ubuziranenge bw'ikigabana cy'ecran. Ibi bifasha gufasha umuntu uri kure, cyangwa kwerekana icyo ukora mu kiganiro cy'itsinda.</p>
<p>Porogaramu ya Windows yerekana ubutumwa muri tray kandi ikomeza gukora iyo ifunze, bityo utabura ubutumwa bwo mu itsinda cyangwa uhamagara. Wibuke ko porogaramu ishyira itarashyiriweho umukono: SmartScreen ishobora kukuburira, hitamo “Andi makuru” hanyuma “Komeza”.</p>`,
      },
      {
        h2: "Urubuga: ubufasha n'indimi",
        html: `<p>Urubuga rwa Chatgram 1.1.3 nta gushyira, kandi rukoresha konti imwe nk'iya telefoni cyangwa mudasobwa. Muri 2026, Help yashyizemo uburyo bwo kohereza raporo zifasha abayobozi gukemura ibibazo: raporo zihinduka GitHub issues, bityo ikibazo kigera ku bakora porogaramu aho kuguma gusa mu kiganiro.</p>
<p>Chatgram iboneka mu ndimi enye: Ikinyarwanda, Icyongereza, Igifaransa n'Ikiswahili. Chatgram AI isubiza mu ndimi izo zose; ishobora kwibeshya kuko ikoresha serivisi ya AI y'undi muryango.</p>`,
      },
      {
        h2: 'Icyo ibi bisobanura kuri wowe',
        html: `<p>Niba ukoresha Android, verisiyo 1.1.7 ituma ubutumwa n'uhamagara bigera n'iyo porogaramu ifunze. Niba ukoresha Windows, 1.1.6 ituma ugabana ecran neza kandi ukagenzura ecran y'undi. Niba ukoresha urubuga, 1.1.3 nta cyo ushyiraho: fungura urubuga gusa.</p>
<p>Ibi byose birahari ku buntu. Konti imwe ikora kuri byose uko ari bitatu, kandi ibikoresho byose ni ubuntu. Reba <a href="/downloads/chatgram-android.apk">APK ya Android</a>, cyangwa <a href="/guides/chatgram-windows-download-smartscreen.html">umwongozo wa Windows</a> n'<a href="/guides/chatgram-android-download-install.html">umwongozo wa Android</a> kugira ngo ubone intambwe zose.</p>`,
      },
    ],
    faq: [
      {
        q: 'Ni iyihe verisiyo nshya kurusha izindi?',
        a: "Verisiyo ziriho ubu ni Android 1.1.7, Windows 1.1.6 na urubuga 1.1.3. Android 1.1.7 yasohotse ku wa 27 Ukwakira 2026. Porogaramu ya Android ireba niba hari APK nshya, irayikurura, igenzura checksum, hanyuma igusaba kuyishyira.",
      },
      {
        q: "Ubutumwa bw'amajwi bukora gute ubu?",
        a: "Ushobora gukanda rimwe utangire, ukurura ibumoso kugira ngo ureke cyangwa ukurura hejuru kugira ngo ufungure ubutumwa. Ushobora kubuhagarika no kubukomeza, ukabona waveform n'igihe bwamaze, kandi ugakina ku muvuduko wa 1.5 cyangwa 2. Ibi biri muri Android 1.1.3 n'inyuma.",
      },
      {
        q: 'Ese ibi byose ni ubuntu?',
        a: "Yego. Nta kwamamaza, nta kwiyandikisha, nta kugura imbere mu porogaramu, kandi nta verisiyo y'ubwishyu. Ibikoresho bishya biri muri verisiyo ziriho ubu ntibisaba amafaranga yiyongera. Konti imwe ikora kuri byose uko ari bitatu ku buntu.",
      },
    ],
  },

  'privacy-and-safety': {
    slug: 'privacy-and-safety',
    title: "Chatgram: ibanga n'umutekano wawe",
    description:
      "Uko Chatgram irinda konti yawe n'ubutumwa bwawe, ibyo ishobora kubona, n'ibyo utegereje ku byerekeye ibanga n'umutekano.",
    h1: "Umutekano n'ibanga muri Chatgram: ibyo ukwiye kumenya",
    updated: '3 Ugushyingo 2026',
    intro:
      "Ibanga n'umutekano ni ibintu bibiri bitandukanye: kimwe ni uko Chatgram irinda ubutumwa mu nzira n'ikindi ni uko ububika kuri seriveri. Iyi paji ivuga neza ibyo birindwa ubu, ibitarakorwa, n'uko wakoresha Chatgram mu mutekano. Ntitwihishe ibintu: niba ubutumwa butashyizwe mu banga kuva ku wohereje kugera ku wakiriye, tubivuga. Amakuru yose ari kuri iyi paji ashingiye ku byo porogaramu ikora ubu.",
    sections: [
      {
        h2: 'Ibyo birindwa ubu',
        html: `<p>Buri gikorwa na buri murongo uhuza porogaramu na seriveri bikoresha HTTPS na WSS hamwe n'icyemezo cya TLS gikora, kivugururwa mu buryo bwikora. Ibi birinda ubutumwa mu nzira hagati ya telefoni cyangwa mudasobwa yawe na seriveri.</p>
<p>Konti yawe irindwa n'ijambo ry'ibanga, kandi ushobora kongeraho kwemeza mu byiciro bibiri hamwe na code zo kugarura zikoreshwa rimwe. Ushobora kureba ibikoresho byose byinjiye kandi usohore sesiyo utifuza ukanda rimwe. Hari kandi igenamiterere ry'ibanga ku muntu kimwe, nk'ukuntu abandi bakubona niba uri kuri interineti cyangwa igihe uheruka kugaragara.</p>`,
      },
      {
        h2: 'Icyo bitarakorwa: nta banga kuva ku wohereje kugera ku wakiriye',
        html: `<p>Chatgram ntabwo ishyira ubutumwa mu banga kuva ku wohereje kugera ku wakiriye. Ubutumwa bushyirwa mu banga mu nzira gusa (HTTPS na WSS), ariko bubikwa kuri seriveri, bityo seriveri ibasha kubusoma. Ibi ni ikintu gikomeye kandi ni byiza kubimenya mbere yo kohereza amakuru y'ibanga cyane.</p>
<p>Ibi ni ukuri kuvugwa mu buryo bweruye: nta banga kuva ku wohereje kugera ku wakiriye, kandi seriveri ibasha kubusoma. Ntukibwire ko ubutumwa bwawe butabonwa na seriveri. Ntabwo twemeza ko ibintu bizahinduka ejo, kandi nta gahunda y'igihe twatangaje.</p>`,
      },
      {
        h2: 'Kurinda konti yawe',
        html: `<p>Koresha ijambo ry'ibanga rikomeye kandi ridasangiwe n'ahandi. Ongeraho kwemeza mu byiciro bibiri kugira ngo umuntu utazi kode yawe atinjire n'ijambo ry'ibanga gusa. Code zo kugarura zikoreshwa rimwe gusa: uzibike ahantu hizewe, ntubazisangize umuntu.</p>
<p>Reba urutonde rw'ibikoresho byinjiye buri gihe, hanyuma usohore ibikoresho utakibona cyangwa utakizi. Gusiba konti birindwa: bisaba ijambo ry'ibanga n'ikode yoherejwe kuri email, kandi hari igihe cy' iminsi 14 cyo kubihagarika. Ibi bituma umuntu utabifitiye uburenganzira adashobora gusiba konti yawe mu buryo buhuse.</p>`,
      },
      {
        h2: 'Gukurura no gushyira mu mutekano',
        html: `<p>Kurura porogaramu gusa ku mahuriro asohowe ku rubuga rwa Chatgram: <a href="/downloads/chatgram-android.apk">APK ya Android</a> na porogaramu ishyira ya Windows. Mbere yo gushyira, gereranya SHA-256 yasohotse n'iyo dosiye yawe; iyo checksum ihura, dosiye ni iyo yasohotse nta guhindurwa.</p>
<p>Kuri Android, uzakenera kwemera “gushyira porogaramu zitazwi” ku mushakishamakuru cyangwa umucunguzi wa dosiye, kuko APK ituruka ku rubuga aho kuri Play Store. Kuri Windows, porogaramu ishyira ntirayashyiriweho umukono, bityo SmartScreen ishobora kukuburira: hitamo “Andi makuru” hanyuma “Komeza”. Reba <a href="/guides/chatgram-windows-download-smartscreen.html">umwongozo wa SmartScreen</a> n'<a href="/guides/chatgram-android-download-install.html">umwongozo wa Android</a>.</p>`,
      },
      {
        h2: 'Gutangaza no guhagarika',
        html: `<p>Iyo umuntu akugirira nabi, ushobora kumuhagarika; ibiri muri Chatgram ntibizongera kukugeraho nk'uko bisanzwe. Ushobora kandi gutangaza ubutumwa ku bayobozi binyuze mu bufasha bwo muri porogaramu. Raporo zigera ku bayobozi babifitiye uburenganzira, kandi ibikorwa by'ubuyobozi bigenda mu rutonde rw'igenzura.</p>
<p>Chatgram AI isubiza hakoreshejwe serivisi ya AI y'undi muryango, bityo ibisubizo bishobora kwibeshya cyangwa kutaba byiza. Ntukayikoreshe nk'umwanya wo guhisha ibintu by'ibanga. Amategeko n'ibanga byuzuye biri kuri <a href="/docs/">paji y'amategeko n'ibanga</a>.</p>`,
      },
      {
        h2: 'Ibikorwa byoroshye byo gukora ubu',
        html: `<p>Menya ibintu bike byoroshye: koresha ijambo ry'ibanga ry'umwihariko, ongeraho kwemeza mu byiciro bibiri, siba ibikoresho utakibona, kandi gereranya checksum mbere yo gushyira. Ntukibwire ko ubutumwa bwawe butabonwa na seriveri.</p>
<p>Niba ukeneye gukoresha Chatgram ku gikoresho gishya, injira n'email imwe kandi urebe ibikoresho byinjiye. Niba ugize ikibazo cyangwa ubona ibintu bidakwiye, tangaza binyuze mu bufasha bwa porogaramu cyangwa urebe <a href="/guides/how-to-use-chatgram.html">umwongozo w'uko wakoresha Chatgram</a>.</p>`,
      },
    ],
    faq: [
      {
        q: 'Ubutumwa bwanjye bushyirwa mu banga bwose?',
        a: "Ntibirakorwa. Ubutumwa bushyirwa mu banga mu nzira (HTTPS/WSS) kandi bubikwa kuri seriveri, ariko seriveri ibasha kubusoma. Gushyira ubutumwa mu banga kuva ku wohereje kugera ku wakiriye ntabwo birashyirwa mu bikorwa ubu.",
      },
      {
        q: 'Nshobora kwizera ibyo nkuruye?',
        a: "Kurura gusa ku rubuga rwa Chatgram cyangwa ku rupapuro rwo gukurura rwemejwe, hanyuma ugereranye SHA-256 yasohotse n'iyo dosiye yawe. Kuri Windows, SmartScreen ishobora kukuburira kubera ko porogaramu ishyira itarashyiriweho umukono; reba umwongozo wa SmartScreen mbere yo gushyira.",
      },
      {
        q: 'Nakora nte niba umuntu ankoresha nabi?',
        a: "Hagarika uwo muntu muri Chatgram, hanyuma utangaze ibibera ku bayobozi binyuze mu bufasha bwo muri porogaramu. Tanga amakuru arambuye uko bishoboka kugira ngo raporo ishobore gusuzumwa. Raporo zose zigenda mu rutonde rw'igenzura.",
      },
    ],
  },
};
