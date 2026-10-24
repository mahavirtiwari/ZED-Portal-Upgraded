package org.qcin.zed.shared

import androidx.core.content.FileProvider

/** Own subclass so the manifest entry never clashes with another library's FileProvider. */
class ZedFileProvider : FileProvider()
