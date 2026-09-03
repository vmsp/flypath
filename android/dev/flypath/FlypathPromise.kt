package dev.flypath

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.coroutines.startCoroutine

@JvmInline
public value class FlypathPromise(private val ref: Long) {
  public fun out(): FlypathOut = FlypathOut(FlypathAbi.promiseOut(ref))

  public fun resolve(): Unit = FlypathAbi.promiseResolve(ref)

  public fun reject(error: Throwable): Unit =
    FlypathAbi.promiseReject(ref, error.toString())
}

public object FlypathTasks {
  private val executor: ExecutorService = Executors.newCachedThreadPool()

  public fun run(promise: FlypathPromise, block: suspend () -> Unit) {
    executor.execute {
      block.startCoroutine(
        Continuation(EmptyCoroutineContext) { result ->
          val error = result.exceptionOrNull()
          if (error != null) promise.reject(error)
        }
      )
    }
  }
}
