import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:geolocator/geolocator.dart';
import 'package:workmanager/workmanager.dart';
import 'geofence_manager.dart';

// Background task name
const String geofenceTaskName = "com.hrportal.geofenceCheckTask";

/// Top-level background execution callback for Workmanager
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    print("🎬 Workmanager background task started: $task");
    WidgetsFlutterBinding.ensureInitialized();
    
    final geofenceManager = GeofenceManager();
    await geofenceManager.initNotifications();
    await geofenceManager.checkGeofences();
    
    return Future.value(true);
  });
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize geofence & notifications manager
  final geofenceManager = GeofenceManager();
  await geofenceManager.initNotifications();

  // Setup background Workmanager schedule
  try {
    await Workmanager().initialize(
      callbackDispatcher,
      isInDebugMode: false,
    );
    
    // Register periodic background task (runs every 15 mins on Android, OS-controlled on iOS)
    await Workmanager().registerPeriodicTask(
      "1",
      geofenceTaskName,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(
        networkType: NetworkType.not_required,
        requiresBatteryNotLow: false,
        requiresCharging: false,
        requiresDeviceIdle: false,
        requiresStorageNotLow: false,
      ),
    );
    print("🎬 Workmanager initialized successfully.");
  } catch (e) {
    print("⚠️ Workmanager initialization failed: $e");
  }

  runApp(const HRPortalApp());
}

class HRPortalApp extends StatelessWidget {
  const HRPortalApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'بوابة الموظفين الذكية',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF5EAD32),
          brightness: Brightness.dark,
        ),
      ),
      home: const PortalWebViewPage(),
    );
  }
}

class PortalWebViewPage extends StatefulWidget {
  const PortalWebViewPage({super.key});

  @override
  State<PortalWebViewPage> createState() => _PortalWebViewPageState();
}

class _PortalWebViewPageState extends State<PortalWebViewPage> {
  // Replace this with your actual hosted production URL of the HR system
  static const String initialUrl = "http://10.0.2.2:5500/index.html"; // Default Android Emulator host pointing to local dev server (VS Code Live Server)
  
  InAppWebViewController? webViewController;
  bool isLoading = true;
  String? loadError;

  @override
  void initState() {
    super.initState();
    _requestLocationPermission();
  }

  /// Request essential permissions for geofencing and camera access
  Future<void> _requestLocationPermission() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      
      if (permission == LocationPermission.always || permission == LocationPermission.whileInUse) {
        // Run immediate geofence check
        await GeofenceManager().checkGeofences();
      }
    } catch (e) {
      print("⚠️ Geolocation permission error: $e");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1218),
      body: SafeArea(
        child: Stack(
          children: [
            // 1. Premium WebView component with Bridge implementation
            InAppWebView(
              initialUrlRequest: URLRequest(url: WebUri(initialUrl)),
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                mediaPlaybackRequiresUserGesture: false,
                allowsInlineMediaPlayback: true,
                iframeAllow: "camera; microphone; geolocation", // Enable camera/GPS inside web views
                iframeAllowFullscreen: true,
                geolocationEnabled: true, // Native GPS passthrough
              ),
              onWebViewCreated: (controller) {
                webViewController = controller;
                _setupJavaScriptBridge(controller);
              },
              onPermissionRequest: (controller, permissionRequest) async {
                // Instantly grant camera and GPS permissions to the embedded web view
                return PermissionResponse(
                  resources: permissionRequest.resources,
                  action: PermissionResponseAction.GRANT,
                );
              },
              onLoadStart: (controller, url) {
                setState(() {
                  isLoading = true;
                  loadError = null;
                });
              },
              onLoadStop: (controller, url) {
                setState(() {
                  isLoading = false;
                });
              },
              onReceivedError: (controller, request, error) {
                // Handle loading failures gracefully (e.g. server offline)
                if (request.isForMainFrame) {
                  setState(() {
                    isLoading = false;
                    loadError = "فشل الاتصال بخادم البوابة الإلكترونية. تأكد من اتصالك بالإنترنت.";
                  });
                }
              },
            ),
            
            // 2. Premium visual loading state matching web portal dark design
            if (isLoading)
              Container(
                color: const Color(0xFF0D1218),
                child: const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      CircularProgressIndicator(
                        valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF5EAD32)),
                      ),
                      SizedBox(height: 20),
                      Text(
                        "جاري تحميل بوابة الموظفين...",
                        style: TextStyle(
                          color: Color(0xFF94A3B8),
                          fontSize: 16,
                          fontFamily: 'Cairo',
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              
            // 3. Error layout with retry button
            if (loadError != null)
              Container(
                color: const Color(0xFF090D16),
                padding: const EdgeInsets.all(24),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.wifi_off_rounded, size: 80, color: Color(0xFFEF4444)),
                      const SizedBox(height: 24),
                      Text(
                        loadError!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontFamily: 'Cairo',
                          height: 1.6,
                        ),
                      ),
                      const SizedBox(height: 24),
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF5EAD32),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        onPressed: () {
                          webViewController?.loadUrl(
                            urlRequest: URLRequest(url: WebUri(initialUrl)),
                          );
                        },
                        icon: const Icon(Icons.refresh_rounded),
                        label: const Text(
                          "إعادة المحاولة",
                          style: TextStyle(fontFamily: 'Cairo', fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// Registers dynamic Javascript channels for active WebView communications
  void _setupJavaScriptBridge(InAppWebViewController controller) {
    // Channel 1: Synchronize assigned work sites (Geofencing configuration)
    controller.addJavaScriptHandler(
      handlerName: 'syncGeofences',
      callback: (args) async {
        if (args.isNotEmpty) {
          final String sitesJson = args[0];
          print("📱 Bridge received 'syncGeofences': $sitesJson");
          await GeofenceManager().saveSites(sitesJson);
        }
        return {'status': 'success'};
      },
    );

    // Channel 2: Synchronize live employee attendance state (Checked IN / OUT)
    controller.addJavaScriptHandler(
      handlerName: 'updateAttendanceState',
      callback: (args) async {
        if (args.isNotEmpty) {
          final String state = args[0];
          print("📱 Bridge received 'updateAttendanceState': $state");
          await GeofenceManager().updateAttendanceState(state);
        }
        return {'status': 'success'};
      },
    );
  }
}
