/**
 * Fonds de l'écran d'accueil : trois scènes dessinées dans la direction graphique du jeu, qui se relaient toutes les minutes.
 * Référence : docs/design/accueil-appareils.md. Les `id` internes de chaque dessin sont uniques (ils partagent le même document).
 */
export interface HomeScene {
  name: string;
  description: string;
  /** Contenu d'un `<svg viewBox="0 0 800 420">` : 800 × 420, recadré pour remplir l'écran. */
  svg: string;
}

export const HOME_SCENES: HomeScene[] = [
  {
    name: 'Rive du lac',
    description: 'Couchant · un parcours régulier le long de l’eau, fait pour tenir une puissance.',
    svg: `
<defs>
<linearGradient id="skyA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3B4690"/><stop offset=".55" stop-color="#8A6FA8"/><stop offset="1" stop-color="#F6C08F"/></linearGradient>
<linearGradient id="lakeA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9A36F"/><stop offset=".3" stop-color="#5A5C9E"/><stop offset="1" stop-color="#3F4C8A"/></linearGradient>
<radialGradient id="sunA"><stop offset="0" stop-color="#FFE3A8"/><stop offset=".4" stop-color="#FFC27A" stop-opacity=".85"/><stop offset="1" stop-color="#FFC27A" stop-opacity="0"/></radialGradient>
</defs>
<rect width="800" height="420" fill="url(#skyA)"/>
<circle cx="560" cy="246" r="170" fill="url(#sunA)"/>
<circle cx="560" cy="246" r="36" fill="#FFD9A0"/>
<g fill="#F6A58F" opacity=".9"><rect x="50" y="86" width="230" height="14" rx="7"/><rect x="104" y="110" width="160" height="10" rx="5"/><rect x="440" y="62" width="270" height="14" rx="7"/><rect x="500" y="86" width="160" height="10" rx="5"/><rect x="250" y="150" width="140" height="9" rx="4.5"/></g>
<g fill="#FFD0A8" opacity=".7"><rect x="80" y="96" width="120" height="6" rx="3"/><rect x="480" y="70" width="150" height="6" rx="3"/></g>
<path d="M0 266 L60 240 L140 260 L230 234 L330 260 L420 246 L520 264 L640 242 L720 258 L800 248 V272 H0Z" fill="#4A4F93"/>
<g fill="#363F7C"><circle cx="20" cy="248" r="10"/><circle cx="54" cy="249" r="6"/><circle cx="88" cy="248" r="9"/><circle cx="122" cy="251" r="6"/><circle cx="156" cy="249" r="6"/><circle cx="190" cy="252" r="9"/><circle cx="224" cy="248" r="10"/><circle cx="258" cy="248" r="7"/><circle cx="292" cy="253" r="11"/><circle cx="326" cy="252" r="6"/><circle cx="360" cy="252" r="10"/><circle cx="394" cy="251" r="6"/><circle cx="428" cy="249" r="6"/><circle cx="462" cy="252" r="7"/><circle cx="496" cy="250" r="9"/><circle cx="530" cy="249" r="10"/><circle cx="564" cy="248" r="10"/><circle cx="598" cy="250" r="10"/><circle cx="632" cy="253" r="7"/><circle cx="666" cy="248" r="10"/><circle cx="700" cy="252" r="11"/><circle cx="734" cy="249" r="8"/><circle cx="768" cy="248" r="10"/></g>
<rect y="262" width="800" height="158" fill="url(#lakeA)"/>
<g fill="#FFC27A" opacity=".8"><rect x="513" y="268" width="92" height="4" rx="2"/><rect x="519" y="277" width="74" height="4" rx="2"/><rect x="510" y="286" width="100" height="4" rx="2"/><rect x="534" y="295" width="60" height="4" rx="2"/><rect x="512" y="304" width="84" height="4" rx="2"/><rect x="530" y="313" width="50" height="4" rx="2"/><rect x="527" y="322" width="70" height="4" rx="2"/><rect x="535" y="331" width="40" height="4" rx="2"/><rect x="531" y="340" width="56" height="4" rx="2"/><rect x="548" y="349" width="30" height="4" rx="2"/></g>
<path d="M0 346 C100 312 240 336 336 420 H0Z" fill="#6F8F52"/>
<path d="M560 420 C600 352 720 304 800 288 V420Z" fill="#5E7F47"/>
<path d="M336 420 C400 348 560 300 800 276 V288 C720 304 600 352 560 420Z" fill="#4D4A5C"/>
<path d="M336 420 C400 348 560 300 800 276" stroke="#fff" stroke-width="3" fill="none"/>
<path d="M448 420 C490 360 620 318 800 282" stroke="#F2C230" stroke-width="4" stroke-dasharray="16 14" fill="none"/>
<g fill="#3E5A3A"><circle cx="46" cy="318" r="30"/><circle cx="84" cy="330" r="22"/><circle cx="20" cy="340" r="24"/><circle cx="150" cy="352" r="18"/></g>
<g fill="#4F7040"><circle cx="40" cy="306" r="18"/><circle cx="148" cy="344" r="10"/></g>
<g stroke="#2E3770" stroke-width="3" fill="none"><path d="M700 330 V300"/><path d="M740 322 V294"/></g>
`,
  },
  {
    name: 'Quais de nuit',
    description: 'La ville illuminée, ses quais et ses barrières néon.',
    svg: `
<defs>
<linearGradient id="skyB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#090D26"/><stop offset="1" stop-color="#2A3468"/></linearGradient>
<linearGradient id="waterB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27316A"/><stop offset="1" stop-color="#0F1440"/></linearGradient>
<radialGradient id="lampB"><stop offset="0" stop-color="#FFE2B0" stop-opacity=".9"/><stop offset="1" stop-color="#FFB861" stop-opacity="0"/></radialGradient>
<radialGradient id="moonB"><stop offset="0" stop-color="#F3F1E6" stop-opacity=".5"/><stop offset="1" stop-color="#F3F1E6" stop-opacity="0"/></radialGradient>
<pattern id="winB" width="9" height="11" patternUnits="userSpaceOnUse"><rect x="2" y="3" width="3.5" height="4.5" fill="#FFB861"/></pattern>
<pattern id="winB2" width="11" height="9" patternUnits="userSpaceOnUse"><rect x="3" y="2" width="4" height="3.5" fill="#FFE2B0"/></pattern>
<filter id="glowB" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>
</defs>
<rect width="800" height="420" fill="url(#skyB)"/>
<g fill="#fff"><circle cx="463" cy="143" r="1" opacity="0.7"/><circle cx="520" cy="150" r="0.8" opacity="0.5"/><circle cx="524" cy="121" r="1.3" opacity="0.9"/><circle cx="190" cy="24" r="1" opacity="0.7"/><circle cx="145" cy="23" r="1.3" opacity="0.9"/><circle cx="649" cy="10" r="1.3" opacity="0.7"/><circle cx="463" cy="167" r="1.3" opacity="0.9"/><circle cx="665" cy="40" r="1.3" opacity="0.5"/><circle cx="541" cy="16" r="0.8" opacity="0.5"/><circle cx="194" cy="61" r="1.3" opacity="0.5"/><circle cx="796" cy="118" r="1" opacity="0.7"/><circle cx="605" cy="50" r="1.3" opacity="0.5"/><circle cx="655" cy="75" r="1" opacity="0.5"/><circle cx="678" cy="21" r="1" opacity="0.9"/><circle cx="284" cy="104" r="1.3" opacity="0.5"/><circle cx="724" cy="65" r="1" opacity="0.5"/><circle cx="525" cy="73" r="0.8" opacity="0.5"/><circle cx="576" cy="27" r="1" opacity="0.5"/><circle cx="297" cy="98" r="0.8" opacity="0.5"/><circle cx="701" cy="0" r="0.8" opacity="0.5"/><circle cx="53" cy="120" r="1" opacity="0.9"/><circle cx="406" cy="107" r="0.8" opacity="0.9"/><circle cx="644" cy="50" r="1.3" opacity="0.7"/><circle cx="344" cy="22" r="1" opacity="0.7"/><circle cx="15" cy="104" r="0.8" opacity="0.5"/><circle cx="252" cy="25" r="0.8" opacity="0.5"/><circle cx="476" cy="124" r="0.8" opacity="0.9"/><circle cx="572" cy="48" r="1" opacity="0.9"/><circle cx="195" cy="33" r="1" opacity="0.9"/><circle cx="392" cy="29" r="1" opacity="0.7"/><circle cx="217" cy="0" r="1" opacity="0.9"/><circle cx="311" cy="5" r="0.8" opacity="0.5"/><circle cx="403" cy="154" r="1.3" opacity="0.9"/><circle cx="102" cy="10" r="0.8" opacity="0.5"/><circle cx="452" cy="66" r="0.8" opacity="0.9"/><circle cx="336" cy="75" r="1" opacity="0.5"/><circle cx="76" cy="23" r="0.8" opacity="0.9"/><circle cx="651" cy="62" r="0.8" opacity="0.9"/><circle cx="377" cy="95" r="1.3" opacity="0.7"/><circle cx="130" cy="150" r="1" opacity="0.9"/><circle cx="138" cy="98" r="0.8" opacity="0.9"/><circle cx="157" cy="79" r="0.8" opacity="0.9"/><circle cx="255" cy="48" r="0.8" opacity="0.9"/><circle cx="644" cy="141" r="0.8" opacity="0.9"/><circle cx="397" cy="123" r="1.3" opacity="0.5"/><circle cx="431" cy="12" r="0.8" opacity="0.5"/><circle cx="39" cy="131" r="1" opacity="0.5"/><circle cx="757" cy="100" r="1" opacity="0.7"/></g>
<circle cx="150" cy="68" r="60" fill="url(#moonB)"/><circle cx="150" cy="68" r="22" fill="#F3F1E6"/><circle cx="158" cy="62" r="22" fill="#2A3468" opacity=".0"/>
<rect y="276" width="800" height="144" fill="url(#waterB)"/>
<rect x="0" y="158" width="52" height="118" fill="#141A44"/><rect x="0" y="158" width="52" height="118" fill="url(#winB2)" opacity="0.8"/><rect x="25" y="148" width="2" height="10" fill="#141A44"/><circle cx="26" cy="147" r="1.8" fill="#FF5FA2"/><rect x="50" y="188" width="40" height="88" fill="#1B2150"/><rect x="50" y="188" width="40" height="88" fill="url(#winB)" opacity="0.6"/><rect x="69" y="178" width="2" height="10" fill="#1B2150"/><circle cx="70" cy="177" r="1.8" fill="#FF5FA2"/><rect x="88" y="124" width="62" height="152" fill="#141A44"/><rect x="88" y="124" width="62" height="152" fill="url(#winB)" opacity="0.6"/><rect x="118" y="114" width="2" height="10" fill="#141A44"/><circle cx="119" cy="113" r="1.8" fill="#FF5FA2"/><rect x="148" y="168" width="46" height="108" fill="#1B2150"/><rect x="148" y="168" width="46" height="108" fill="url(#winB2)" opacity="0.8"/><rect x="170" y="158" width="2" height="10" fill="#1B2150"/><circle cx="171" cy="157" r="1.8" fill="#FF5FA2"/><rect x="192" y="90" width="72" height="186" fill="#141A44"/><rect x="192" y="90" width="72" height="186" fill="url(#winB)" opacity="0.45"/><rect x="227" y="80" width="2" height="10" fill="#141A44"/><circle cx="228" cy="79" r="1.8" fill="#FF5FA2"/><rect x="262" y="146" width="50" height="130" fill="#1B2150"/><rect x="262" y="146" width="50" height="130" fill="url(#winB)" opacity="0.8"/><rect x="286" y="136" width="2" height="10" fill="#1B2150"/><circle cx="287" cy="135" r="1.8" fill="#FF5FA2"/><rect x="310" y="178" width="60" height="98" fill="#141A44"/><rect x="310" y="178" width="60" height="98" fill="url(#winB2)" opacity="0.45"/><rect x="339" y="168" width="2" height="10" fill="#141A44"/><circle cx="340" cy="167" r="1.8" fill="#FF5FA2"/><rect x="368" y="114" width="46" height="162" fill="#1B2150"/><rect x="368" y="114" width="46" height="162" fill="url(#winB)" opacity="0.45"/><rect x="390" y="104" width="2" height="10" fill="#1B2150"/><circle cx="391" cy="103" r="1.8" fill="#FF5FA2"/><rect x="412" y="156" width="72" height="120" fill="#141A44"/><rect x="412" y="156" width="72" height="120" fill="url(#winB)" opacity="0.45"/><rect x="447" y="146" width="2" height="10" fill="#141A44"/><circle cx="448" cy="145" r="1.8" fill="#FF5FA2"/><rect x="482" y="98" width="54" height="178" fill="#1B2150"/><rect x="482" y="98" width="54" height="178" fill="url(#winB2)" opacity="0.6"/><rect x="508" y="88" width="2" height="10" fill="#1B2150"/><circle cx="509" cy="87" r="1.8" fill="#FF5FA2"/><rect x="534" y="172" width="46" height="104" fill="#141A44"/><rect x="534" y="172" width="46" height="104" fill="url(#winB)" opacity="0.8"/><rect x="556" y="162" width="2" height="10" fill="#141A44"/><circle cx="557" cy="161" r="1.8" fill="#FF5FA2"/><rect x="586" y="134" width="66" height="142" fill="#1B2150"/><rect x="586" y="134" width="66" height="142" fill="url(#winB)" opacity="0.8"/><rect x="618" y="124" width="2" height="10" fill="#1B2150"/><circle cx="619" cy="123" r="1.8" fill="#FF5FA2"/><rect x="650" y="180" width="50" height="96" fill="#141A44"/><rect x="650" y="180" width="50" height="96" fill="url(#winB2)" opacity="0.8"/><rect x="674" y="170" width="2" height="10" fill="#141A44"/><circle cx="675" cy="169" r="1.8" fill="#FF5FA2"/><rect x="698" y="144" width="62" height="132" fill="#1B2150"/><rect x="698" y="144" width="62" height="132" fill="url(#winB)" opacity="0.8"/><rect x="728" y="134" width="2" height="10" fill="#1B2150"/><circle cx="729" cy="133" r="1.8" fill="#FF5FA2"/><rect x="758" y="164" width="44" height="112" fill="#141A44"/><rect x="758" y="164" width="44" height="112" fill="url(#winB)" opacity="0.45"/><rect x="779" y="154" width="2" height="10" fill="#141A44"/><circle cx="780" cy="153" r="1.8" fill="#FF5FA2"/>
<g fill="#FFB861" opacity=".28"><rect x="6" y="282" width="5" height="11" rx="2"/><rect x="28" y="285" width="4" height="9" rx="2"/><rect x="50" y="282" width="7" height="15" rx="2"/><rect x="72" y="281" width="4" height="8" rx="2"/><rect x="94" y="281" width="6" height="13" rx="2"/><rect x="116" y="284" width="8" height="10" rx="2"/><rect x="138" y="280" width="6" height="10" rx="2"/><rect x="160" y="283" width="6" height="18" rx="2"/><rect x="182" y="285" width="9" height="16" rx="2"/><rect x="204" y="284" width="5" height="17" rx="2"/><rect x="226" y="280" width="4" height="15" rx="2"/><rect x="248" y="282" width="9" height="12" rx="2"/><rect x="270" y="280" width="4" height="17" rx="2"/><rect x="292" y="285" width="4" height="15" rx="2"/><rect x="314" y="280" width="9" height="12" rx="2"/><rect x="336" y="282" width="5" height="9" rx="2"/><rect x="358" y="280" width="7" height="16" rx="2"/><rect x="380" y="282" width="9" height="8" rx="2"/><rect x="402" y="285" width="9" height="19" rx="2"/><rect x="424" y="281" width="6" height="13" rx="2"/><rect x="446" y="280" width="9" height="15" rx="2"/><rect x="468" y="280" width="7" height="20" rx="2"/><rect x="490" y="280" width="7" height="17" rx="2"/><rect x="512" y="280" width="8" height="18" rx="2"/><rect x="534" y="283" width="7" height="17" rx="2"/><rect x="556" y="280" width="8" height="9" rx="2"/><rect x="578" y="280" width="4" height="18" rx="2"/><rect x="600" y="280" width="6" height="14" rx="2"/><rect x="622" y="285" width="6" height="14" rx="2"/><rect x="644" y="285" width="9" height="17" rx="2"/><rect x="666" y="283" width="7" height="15" rx="2"/><rect x="688" y="286" width="8" height="9" rx="2"/><rect x="710" y="284" width="8" height="8" rx="2"/><rect x="732" y="282" width="8" height="9" rx="2"/><rect x="754" y="283" width="4" height="11" rx="2"/><rect x="776" y="285" width="4" height="15" rx="2"/><rect x="798" y="286" width="8" height="18" rx="2"/></g>
<path d="M0 312 L396 286 L322 420 H0Z" fill="#2E3150"/>
<path d="M0 306 L395 283" stroke="#8A90B0" stroke-width="2.5" fill="none"/>
<path d="M404 286 L800 304 V420 H636Z" fill="#232640"/>
<path d="M396 284 L404 284 L636 420 H322Z" fill="#3A3D50"/>
<path d="M396 284 L322 420 M404 284 L636 420" stroke="#F3F6FA" stroke-width="3" fill="none"/>
<path d="M400 292 V304 M400 318 V338 M400 356 V384 M400 402 V420" stroke="#F3F6FA" stroke-width="4" fill="none" opacity=".85"/>
<g filter="url(#glowB)" opacity=".8"><path d="M416 288 L656 420" stroke="#5BE3C9" stroke-width="12" stroke-dasharray="30 30" fill="none"/><path d="M416 288 L656 420" stroke="#FF5FA2" stroke-width="12" stroke-dasharray="30 30" stroke-dashoffset="30" fill="none"/></g>
<path d="M416 288 L656 420" stroke="#5BE3C9" stroke-width="9" stroke-dasharray="30 30" fill="none"/>
<path d="M416 288 L656 420" stroke="#FF5FA2" stroke-width="9" stroke-dasharray="30 30" stroke-dashoffset="30" fill="none"/>
<circle cx="170" cy="176" r="64" fill="url(#lampB)"/>
<path d="M96 408 V196 Q96 178 124 175 L164 172" stroke="#8A90B0" stroke-width="5" stroke-linecap="round" fill="none"/>
<ellipse cx="168" cy="173" rx="12" ry="5" fill="#FFE2B0"/>
`,
  },
  {
    name: 'Col des Érables',
    description: 'Automne · la montée du col sous les érables roux.',
    svg: `
<defs>
<linearGradient id="skyC" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E9AD6"/><stop offset="1" stop-color="#FBE3C0"/></linearGradient>
<radialGradient id="sunC"><stop offset="0" stop-color="#FFF4D6"/><stop offset="1" stop-color="#FFF4D6" stop-opacity="0"/></radialGradient>
</defs>
<rect width="800" height="420" fill="url(#skyC)"/>
<circle cx="660" cy="96" r="110" fill="url(#sunC)" opacity=".85"/>
<g fill="#fff" opacity=".95"><ellipse cx="130" cy="74" rx="66" ry="22"/><ellipse cx="180" cy="62" rx="40" ry="20"/><ellipse cx="520" cy="112" rx="70" ry="20"/><ellipse cx="566" cy="100" rx="38" ry="18"/></g>
<path d="M0 238 L70 176 L150 226 L250 150 L360 236 L470 172 L580 232 L690 158 L800 232 V290 H0Z" fill="#A9A7C2"/>
<path d="M250 150 L274 176 L260 172 L248 188 L236 172 L224 178Z M690 158 L712 182 L700 178 L688 192 L676 178 L664 182Z" fill="#F3F6FA"/>
<path d="M0 262 L90 214 L190 256 L300 220 L400 262 L520 222 L640 258 L730 226 L800 256 V300 H0Z" fill="#8A8F97"/>
<path d="M0 276 C120 238 260 252 400 268 C540 250 680 232 800 272 V420 H0Z" fill="#C9A24A"/>
<path d="M0 306 C140 276 280 290 360 330 L330 420 H0Z" fill="#B58532"/>
<path d="M800 300 C700 270 560 286 440 330 L490 420 H800Z" fill="#B58532"/>
<circle cx="250" cy="263" r="10" fill="#357552"/><circle cx="267" cy="263" r="8" fill="#357552"/><circle cx="284" cy="265" r="10" fill="#D9531E"/><circle cx="301" cy="266" r="6" fill="#F2C230"/><circle cx="318" cy="264" r="10" fill="#E8892B"/><circle cx="335" cy="263" r="9" fill="#357552"/><circle cx="352" cy="266" r="9" fill="#F2C230"/><circle cx="369" cy="267" r="7" fill="#E8892B"/><circle cx="436" cy="267" r="7" fill="#357552"/><circle cx="453" cy="265" r="6" fill="#D9531E"/><circle cx="470" cy="263" r="10" fill="#D9531E"/><circle cx="487" cy="264" r="6" fill="#C2331F"/><circle cx="504" cy="265" r="10" fill="#F2C230"/><circle cx="521" cy="267" r="9" fill="#F2C230"/><circle cx="538" cy="267" r="10" fill="#F2C230"/><circle cx="555" cy="263" r="8" fill="#D9531E"/>
<path d="M350 420 L388 266 L412 266 L580 420Z" fill="#4C505B"/>
<path d="M388 266 L350 420 M412 266 L580 420" stroke="#fff" stroke-width="3" fill="none"/>
<path d="M400 274 V292 M400 312 V340 M400 366 V420" stroke="#F2C230" stroke-width="5" fill="none"/>
<rect x="297.6" y="295.2" width="4.8" height="8.0" fill="#5A3A22"/><path d="M280.8 296.8 L300.0 256.8 L319.2 296.8Z" fill="#357552"/><path d="M284.8 274.4 L300.0 237.6 L315.2 274.4Z" fill="#2E6B4A"/><rect x="517.6" y="301.2" width="4.8" height="8.0" fill="#5A3A22"/><path d="M500.8 302.8 L520.0 262.8 L539.2 302.8Z" fill="#357552"/><path d="M504.8 280.4 L520.0 243.6 L535.2 280.4Z" fill="#2E6B4A"/>
<rect x="66.5" y="355.5" width="6.9" height="39.1" fill="#7A4A2A"/><circle cx="70" cy="323.3" r="39.1" fill="#D9531E"/><circle cx="44.7" cy="341.7" r="27.6" fill="#E8892B"/><circle cx="97.6" cy="339.4" r="29.9" fill="#C2331F"/><circle cx="72.3" cy="295.7" r="23.0" fill="#F2C230"/><rect x="187.4" y="326.5" width="5.1" height="28.9" fill="#7A4A2A"/><circle cx="190" cy="302.7" r="28.9" fill="#D9531E"/><circle cx="171.3" cy="316.3" r="20.4" fill="#E8892B"/><circle cx="210.4" cy="314.6" r="22.1" fill="#C2331F"/><circle cx="191.7" cy="282.3" r="17.0" fill="#F2C230"/><rect x="668.7" y="347.0" width="6.6" height="37.4" fill="#7A4A2A"/><circle cx="672" cy="316.2" r="37.4" fill="#D9531E"/><circle cx="647.8" cy="333.8" r="26.4" fill="#E8892B"/><circle cx="698.4" cy="331.6" r="28.6" fill="#C2331F"/><circle cx="674.2" cy="289.8" r="22.0" fill="#F2C230"/><rect x="747.6" y="322.0" width="4.8" height="27.2" fill="#7A4A2A"/><circle cx="750" cy="299.6" r="27.2" fill="#D9531E"/><circle cx="732.4" cy="312.4" r="19.2" fill="#E8892B"/><circle cx="769.2" cy="310.8" r="20.8" fill="#C2331F"/><circle cx="751.6" cy="280.4" r="16.0" fill="#F2C230"/><rect x="597.0" y="340.0" width="6.0" height="10.0" fill="#5A3A22"/><path d="M576.0 342.0 L600.0 292.0 L624.0 342.0Z" fill="#357552"/><path d="M581.0 314.0 L600.0 268.0 L619.0 314.0Z" fill="#2E6B4A"/>
<g fill="#B9BCC4"><ellipse cx="255" cy="372" rx="22" ry="9"/><ellipse cx="560" cy="384" rx="26" ry="10"/></g>
`,
  },
];

export const SCENE_ROTATION_MS = 60_000;
