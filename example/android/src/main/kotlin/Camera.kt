import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable
fun CameraPreview(facing: CameraFacing) {
  val context = LocalContext.current
  val owner = LocalLifecycleOwner.current

  var granted by remember {
    mutableStateOf(
      ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
    )
  }

  val request =
    rememberLauncherForActivityResult(
      ActivityResultContracts.RequestPermission()
    ) {
      granted = it
    }

  LaunchedEffect(granted) {
    if (!granted) request.launch(Manifest.permission.CAMERA)
  }

  if (!granted) return

  AndroidView(
    modifier = Modifier,
    factory = {
      PreviewView(it).apply {
        implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      }
    },
    update = { view ->
      val future = ProcessCameraProvider.getInstance(view.context)
      future.addListener(
        {
          val preview = Preview.Builder().build()
          preview.surfaceProvider = view.surfaceProvider
          val provider = future.get()
          provider.unbindAll()
          provider.bindToLifecycle(
            owner,
            if (facing == CameraFacing.FRONT)
              CameraSelector.DEFAULT_FRONT_CAMERA
            else CameraSelector.DEFAULT_BACK_CAMERA,
            preview,
          )
        },
        ContextCompat.getMainExecutor(view.context),
      )
    },
  )
}
