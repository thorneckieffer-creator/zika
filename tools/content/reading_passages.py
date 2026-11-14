# -*- coding: utf-8 -*-
"""Reading passages for 字卡 — original short texts, written for this app.

Each passage belongs to one lesson and uses only characters met by the end of that lesson, leaning on
that lesson's new words and grammar. Different passages put the same vocabulary in different settings.
tools/check_reading.py verifies the vocabulary and installs them into index.html.

R[(book, lesson)] = [ {t: title, en: English title, zh: text, tr: English translation}, … ]
"""
R = {
 (3, 1): [
  dict(t='開學第一天', en='The first day of term',
       zh='今天開學了。我們班有不到二十個學生，新生只有我一個。老師很嚴，她說明得很清楚：每個星期筆試以外，還有口試和口頭報告。我的口才不好，所以壓力很大。第一天我起得太晚，差一點遲到，好不容易才找到位子。旁邊的同學告訴我，不管功課多不多，他每天都很用功。我想，這樣下去的話，恐怕我也得熬夜了。',
       tr='Term started today. Our class has fewer than twenty students, and I am the only new one. The teacher is strict, and she explained it clearly: besides a written test every week, there is an oral test and an oral report. I am not a good speaker, so I feel a lot of pressure. On the first day I got up too late and was almost late; I only just managed to find a seat. The classmate next to me told me that whether or not there is much homework, he works hard every day. I thought: if it goes on like this, I am afraid I will have to stay up late too.'),
  dict(t='她想轉系', en='She wants to change majors',
       zh='美美是獨生女，念的是私立大學的會計系。會計系很熱門，可是跟她的個性不合，她念得很痛苦。她的個性活潑，外語也好，所以想轉到外語系。父母反對，他們擔心她以後找不到工作。美美說，不管父母反對不反對，她都不想放棄自己的理想。她好不容易才填好表，辦了申請手續，老師也幫她寫了推薦信。成績單沒問題的話，下個學期她就能轉系了。',
       tr='Meimei is an only daughter studying accounting at a private university. Accounting is a popular major, but it does not suit her personality, and studying it makes her miserable. She is lively and good at foreign languages, so she wants to transfer to the foreign languages department. Her parents object; they worry she will not find a job later. Meimei says that whether her parents object or not, she does not want to give up her own ideal. She finally managed to fill in the form and go through the application, and her teacher wrote her a recommendation letter. If her transcript is fine, she can change majors next semester.'),
 ],
 (3, 2): [
  dict(t='週年慶', en='The anniversary sale',
       zh='百貨公司的週年慶到了，很多商品都打折，八折起。我想買一件外套。店員給我看一件羊毛的，摸起來很舒服，樣子也好看，可是有一點短。一般來說，這個牌子的品質不錯，打完折比原價省了一千多塊。我沒帶那麼多現金，只好刷卡。回家以後，我才看到外套上有一個破洞。還好發票沒弄丟，第二天我就拿去換了一件。',
       tr='The department store’s anniversary sale has arrived, and many goods are discounted, from 20% off. I wanted to buy a coat. The clerk showed me a wool one; it felt comfortable and looked good, but it was a little short. Generally speaking this brand’s quality is good, and after the discount it was more than a thousand dollars below the original price. I had not brought that much cash, so I had to pay by card. Only after I got home did I see a hole in the coat. Luckily I had not lost the receipt, and the next day I took it back and exchanged it.'),
  dict(t='手機的帳單', en='The phone bill',
       zh='上個月我在電信門市辦了月租型的手機。店員說每個月只要五百塊。可是帳單來了，我嚇了一跳，並不是五百塊，是九百多塊。我打電話到客服中心，他們解釋說，五百塊並不包括上網的錢。我覺得自己被騙了，尤其是店員沒說清楚。再說，我的手機常常自動關機，還得拿去修理。朋友說，像我這樣的顧客最好換成預付卡，不然就選吃到飽的。',
       tr='Last month I signed up for a monthly phone plan at a telecom shop. The clerk said it was only five hundred dollars a month. But when the bill came I got a shock: it was not five hundred at all, it was over nine hundred. I called the customer service centre, and they explained that the five hundred does not include data. I felt cheated, especially because the clerk had not made it clear. Besides, my phone often shuts itself off and has to go in for repair. A friend said a customer like me had better switch to a prepaid card, or else choose the unlimited plan.'),
 ],
 (3, 3): [
  dict(t='台北的天氣', en='Taipei weather',
       zh='台北的天氣變化很大，就像後母臉，說變就變。早上還出大太陽，下午就颳風下雨。雨季的時候幾乎天天下雨，空氣又悶又潮濕，衣服很容易發霉，幸虧我買了一台除濕機。夏天的氣溫常常是三十五度，感覺比實際的溫度還熱，沒有冷氣的話，我真受不了。冬天不到零下，算是暖和的，可是受到濕氣的影響，還是覺得很冷。難怪台灣人冬天那麼愛吃火鍋。',
       tr='Taipei’s weather changes a great deal — like a stepmother’s face, it turns just like that. In the morning the sun is blazing, and by afternoon it is windy and raining. In the rainy season it rains almost every day; the air is stuffy and damp and clothes go mouldy easily, so luckily I bought a dehumidifier. In summer it is often thirty-five degrees and feels hotter than the actual temperature; without air conditioning I really could not stand it. Winter does not go below zero, so it counts as mild, but because of the damp it still feels cold. No wonder Taiwanese people love hot pot so much in winter.'),
  dict(t='中秋節', en='The Mid-Autumn Festival',
       zh='農曆八月十五是中秋節。古時候的農人在這個季節收成，所以要拜神、祭祖，謝謝祖先。現在住在城市裡的人多少還有這個習慣。這一天最重要的事是團聚：工作再忙，大家也要回家。晚上月亮又大又圓，一家人坐在外面吃月餅和柚子，聽老人說月亮的故事，感覺很溫馨。有人說這些做法是迷信，可是我覺得過節的作用是讓家人難得見一次面。',
       tr='The fifteenth day of the eighth lunar month is the Mid-Autumn Festival. In ancient times farmers brought in the harvest in this season, so they worshipped the gods and made offerings to thank their ancestors. People living in cities today still keep something of this custom. The most important thing on this day is being together: however busy work is, everyone goes home. In the evening the moon is big and round, and the family sits outside eating mooncakes and pomelos and listening to the old folks tell stories about the moon; it feels very warm. Some say these practices are superstition, but I think the point of a festival is to give a family a rare chance to see each other.'),
 ],
 (3, 4): [
  dict(t='平溪放天燈', en='Sky lanterns in Pingxi',
       zh='元宵節那天，我跟同學上平溪放天燈。我們在天燈上寫了願望，我寫的是「希望我的中文越來越好」。山上手機沒有訊號，還好我們碰到一位當地的老闆，他很有耐心地告訴我們怎麼走，還請我們喝紅茶。他說他開店不是為了賺錢，而是喜歡交朋友。台灣的人情味不但有名，還讓我很感動。回台北以前，我們吃了雞排和水煎包，價錢不貴，吃一口就知道很道地。這次校外教學，我一點也不覺得無聊。',
       tr='On the Lantern Festival, my classmates and I went up to Pingxi to release sky lanterns. We wrote our wishes on the lantern; mine was “I hope my Chinese keeps getting better.” There was no phone signal on the mountain, but luckily we ran into a local shop owner who patiently told us the way and even treated us to black tea. He said he did not open his shop to make money, but because he likes making friends. Taiwanese hospitality is not only famous; it really moved me. Before going back to Taipei we ate fried chicken cutlet and pan-fried buns; they were not expensive, and one bite told us they were the real thing. On this field trip I was not bored for a moment.'),
  dict(t='非去台南不可', en='You simply have to go to Tainan',
       zh='我的同事鈴木說，喜歡美食的人非去台南不可。台南是台灣最古老的城市，有很多古蹟，像赤崁樓和孔廟，還有不少木造的老房子留下來。台南人重視歷史和風俗，對吃也很講究，早上的一碗粥都很道地。那裡的街道很窄，生活的速度很慢。我從來沒去過，鈴木說我錯過了很多。下個月我打算在台南待三天，白天欣賞美麗的古蹟，晚上看夜景、吃擔仔麵。',
       tr='My colleague Suzuki says anyone who loves good food simply has to go to Tainan. Tainan is Taiwan’s oldest city and has many historic sites, such as Chihkan Tower and the Confucius Temple, and quite a few old wooden houses survive. People in Tainan value history and custom and are particular about food too; even a bowl of morning congee is the real thing. The streets there are narrow and the pace of life is slow. I have never been, and Suzuki says I have missed a lot. Next month I plan to spend three days in Tainan, admiring the beautiful sites by day and enjoying the night view and danzai noodles in the evening.'),
 ],
}
