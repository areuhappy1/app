pH Color Analyzer V5

V5 CHANGES

1. Prediction accuracy returned to the V3 method
- V4 used up to 4 nearest pH reference classes.
- V5 returns to the V3 method: 3 nearest pH reference classes.
- Distance weighting is the same V3-style inverse-distance interpolation.
- This prevents a more distant fourth reference color from pulling the result.

2. Direct final pH entry
After measuring a photo, type a final value such as:
7.20
and press:
[입력값 적용]

The program calculates the required temporary adjustment automatically.

Example:
Raw prediction        7.46
Site correction      -0.10
Site corrected        7.36
Direct final input    7.20
Temporary adjustment -0.16
Final display         7.20

3. Save adjustment to the site profile
If the manual/direct correction is repeatedly appropriate at that site,
press:
[이 조정값을 현장보정으로 저장]

That correction becomes the permanent offset for the selected site.

4. Persistent pH color data
V5 continues to use:
C:\Users\YOURNAME\pH_Analyzer_Data

So V4 reference colors, site profiles and results are retained.
Closing the program does not remove them.

5. Decimal reference pH
Use:
[소수점 기준 추가 (예: 7.5)]
to add 6.5, 7.2, 7.5, 8.3 etc.

IMPORTANT
- If V4 already saved a wrong site offset, select the site and use
  [현장 보정값 0으로 초기화] before comparing V3 vs V5 raw prediction.
- Compare "기본 예측값" first. Site correction changes the displayed result
  but does not change the color model.
- Use real known-pH reference samples for training.
- Do not train using the program's own predicted value.

BUILD EXE
1. Extract ZIP.
2. Double-click BUILD_EXE_V5.bat.
3. Wait for SUCCESS.
4. Run dist\pH_Analyzer_v5.exe
