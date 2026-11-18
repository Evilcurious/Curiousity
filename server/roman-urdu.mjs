// Urdu normally omits short vowels. This offline fallback uses familiar spellings for
// common words and approximate letter readings for the rest; it is not a translator.
const common = new Map(`یہ:yeh وہ:woh کیا:kya کیوں:kyun کیسے:kaise کہاں:kahan کب:kab کون:kaun یہاں:yahan وہاں:wahan یوں:yun ویسے:waise ایسے:aise جیسا:jaisa ایسا:aisa جس:jis
جو:jo کس:kis جسے:jisay جن:jin سب:sab کچھ:kuch کوئی:koi بھی:bhi نہیں:nahi نا:na ہے:hai ہیں:hain تھا:tha تھی:thi تھے:thay ہوں:hoon ہو:ho ہوا:hua ہوئی:hui ہوئے:huay ہوگا:hoga ہوگی:hogee ہونا:hona شکریہ:shukriya سلام:salaam علیکم:alaikum وعلیکم:walaikum
ہم:hum ہمیں:humein ہمارا:hamara ہماری:hamari میں:mein مجھے:mujhe میرا:mera میری:meri میرے:mere آپ:aap تم:tum تمہیں:tumhein تیرا:tera اپنا:apna اپنے:apne اپنی:apni اسے:usay اس:is ان:un سے:se نے:ne کو:ko کا:ka کی:ki کے:ke پر:par تک:tak تو:toh اور:aur یا:ya اگر:agar مگر:magar لیکن:lekin کہ:ke کیونکہ:kyunke جب:jab پھر:phir بس:bas لیے:liye لئے:liye تاکہ:taake ساتھ:saath بغیر:baghair بعد:baad پہلے:pehle ابھی:abhi اب:ab
ایک:aik دو:do تین:teen چار:chaar پانچ:paanch چھ:chhe سات:saat آٹھ:aath نو:nau دس:das زیادہ:zyada کم:kam بہت:bohat تھوڑا:thora صرف:sirf تمام:tamaam کافی:kaafi ہر:har ہمیشہ:hamesha کبھی:kabhi آج:aaj کل:kal وقت:waqt دن:din رات:raat صبح:subah
بات:baat اہم:aham اچھی:achhi اچھا:achha اچھے:achhay برا:bura درست:durust غلط:ghalat ٹھیک:theek مشکل:mushkil آسان:aasaan خوب:khub خوش:khush واقعی:waqai حقیقت:haqeeqat نئی:nayi نیا:naya بڑی:bari بڑا:bara چھوٹا:chhota چھوٹی:chhoti مختلف:mukhtalif بہترین:behtareen تیز:tez دھیمی:dheemi اصل:asal خاص:khaas
کہانی:kahani جملہ:jumla لمحہ:lamha لمحات:lamhaat وجہ:wajah آغاز:aaghaz شروع:shuru آخر:aakhir ختم:khatam سوال:sawaal جواب:jawaab تبدیلی:tabdeeli ضروری:zaroori طریقہ:tareeqa کامیاب:kamyaab زندگی:zindagi دوست:dost لوگ:log انسان:insaan نام:naam جگہ:jagah دنیا:duniya گھر:ghar سکول:school پاکستان:Pakistan لاہور:Lahore اردو:Urdu خبر:khabar
ویڈیو:video آڈیو:audio کلپ:clip چینل:channel سیکنڈ:second ریکارڈ:record ایڈٹ:edit شارٹ:short مشورہ:mashwara آواز:aawaaz بند:band کھول:khol اثر:asar حصہ:hissa رفتار:raftaar دلچسپ:dilchasp لمبا:lamba خوبصورت:khoobsurat
کر:kar کرنا:karna کرتا:karta کرتی:karti کرتے:kartay کریں:karein بنانا:banana بنایا:banaya دیکھ:dekh دیکھیں:dekhein دیکھنا:dekhna دیکھے:dekhay دیکھتے:dekhtay سننا:sunna سنیں:sunein سننے:sunnay پڑھنا:parhna پڑھیں:parhein رہنا:rehna رہنے:rehnay جاننا:jaanna جانتے:jaantay چاہتا:chahta چاہتے:chahtay چاہیئے:chahiye چاہیے:chahiye سمجھے:samjhay سمجھ:samajh سکتا:sakta سکتی:sakti سکتے:saktay جانا:jana آیا:aaya آتا:aata آتی:aati آنا:aana جائیں:jayein ملتا:milta ملتی:milti ملے:milay گا:ga گی:gi گے:gay دیا:diya دینا:dena دیں:dein`.split(/\s+/).map((entry) => {
  const [word, roman] = entry.split(':');
  return [word.normalize('NFKC'), roman];
}));

const alphabet = {
  آ: 'aa', ا: 'a', أ: 'a', إ: 'i', ب: 'b', پ: 'p', ت: 't', ٹ: 't', ث: 's', ج: 'j', چ: 'ch', ح: 'h', خ: 'kh', د: 'd', ڈ: 'd', ذ: 'z', ر: 'r', ڑ: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's', ض: 'z', ط: 't', ظ: 'z', ع: '', غ: 'gh', ف: 'f', ق: 'q', ک: 'k', ك: 'k', گ: 'g', ل: 'l', م: 'm', ن: 'n', ں: 'n', و: 'o', ؤ: 'o', ہ: 'h', ه: 'h', ھ: 'h', ة: 'a', ی: 'i', ي: 'i', ئ: 'i', ے: 'ay', ء: '', 'َ': 'a', 'ِ': 'i', 'ُ': 'u', 'ّ': '', 'ْ': '',
};

function readWord(word) {
  const bare = word.replace(/\p{M}/gu, '');
  const known = common.get(bare);
  if (known) return known;
  const letters = [...word];
  const readings = letters.map((letter, index) => {
    if (letter === 'ا' && index > 0) return 'aa';
    if ((letter === 'ی' || letter === 'ي') && index === 0) return 'y';
    if (letter === 'و' && index === 0) return 'w';
    return Object.hasOwn(alphabet, letter) ? alphabet[letter] : /\p{M}/u.test(letter) ? '' : letter;
  });
  // Add a short vowel to otherwise vowelless words. A chat model can use context
  // to choose the right reading for names or words that have several spellings.
  if (readings.length > 1 && !readings.some((part) => /^[aeiou]/.test(part))) {
    const vowelAt = letters[1] === 'ھ' ? 1 : 0;
    readings[vowelAt] += 'a';
  }
  return readings.join('');
}

export function isLatinCaption(value) {
  return (value.match(/\p{L}/gu) || []).every((letter) => /\p{Script=Latin}/u.test(letter));
}

const punctuation = { '،': ',', '؛': ';', '؟': '?', '۔': '.', '٪': '%', '٫': '.', '٬': ',', '؍': '/' };

export function romanizeUrdu(value) {
  return value.normalize('NFKC').replace(/[\u061c\u200c-\u200f\u202a-\u202e\u2066-\u2069\u0640]/g, '')
    .replace(/[۰-۹٠-٩]/g, (digit) => String(digit.codePointAt(0) & 15))
    .replace(/[،؛؟۔٪٫٬؍]/g, (glyph) => punctuation[glyph])
    .replace(/[\p{Script=Arabic}\p{M}]+/gu, (word) => /\p{Script=Arabic}/u.test(word) ? readWord(word) : word);
}
