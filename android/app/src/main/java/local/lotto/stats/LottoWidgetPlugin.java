package local.lotto.stats;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 웹 화면 → 위젯 다시 그리기 (src/app/native.ts의 LottoWidget.refresh) */
@CapacitorPlugin(name = "LottoWidget")
public class LottoWidgetPlugin extends Plugin {
    @PluginMethod
    public void refresh(PluginCall call) {
        LottoWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
