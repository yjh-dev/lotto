package local.lotto.stats;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 홈 화면 위젯: 이번 주 추천 번호 (최대 10줄).
 * 데이터는 웹 화면이 @capacitor/preferences로 써 둔 SharedPreferences("CapacitorStorage")의 "widget" 값
 *   {"round":1251,"picks":[[7,16,17,20,42,43],...]}
 */
public class LottoWidgetProvider extends AppWidgetProvider {
    private static final int[] ROWS = {
        R.id.widget_row1, R.id.widget_row2, R.id.widget_row3, R.id.widget_row4, R.id.widget_row5,
        R.id.widget_row6, R.id.widget_row7, R.id.widget_row8, R.id.widget_row9, R.id.widget_row10
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    /** 앱에서 추천이 바뀌면 호출 (LottoWidgetPlugin) */
    public static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, LottoWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_lotto);
        SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String raw = prefs.getString("widget", null);
        String title = "앱을 열면 추천 번호가 표시됩니다";
        String[] rows = new String[ROWS.length];
        if (raw != null) {
            try {
                JSONObject o = new JSONObject(raw);
                title = o.getInt("round") + "회 추천";
                JSONArray picks = o.getJSONArray("picks");
                for (int i = 0; i < ROWS.length && i < picks.length(); i++) {
                    JSONArray p = picks.getJSONArray(i);
                    StringBuilder sb = new StringBuilder();
                    for (int j = 0; j < p.length(); j++) {
                        if (j > 0) sb.append("  ");
                        sb.append(String.format("%2d", p.getInt(j)));
                    }
                    rows[i] = sb.toString();
                }
            } catch (Exception ignored) {
                // 형식이 바뀌었으면 안내 문구만
            }
        }
        views.setTextViewText(R.id.widget_title, title);
        for (int i = 0; i < ROWS.length; i++) views.setTextViewText(ROWS[i], rows[i] == null ? "" : rows[i]);

        // 위젯을 누르면 앱 열기
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pi);
        return views;
    }
}
