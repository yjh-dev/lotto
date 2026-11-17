package local.lotto.stats;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LottoWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
