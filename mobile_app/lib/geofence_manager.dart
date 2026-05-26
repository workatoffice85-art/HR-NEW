import 'dart:convert';
import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:geolocator/geolocator.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class GeofenceManager {
  static final GeofenceManager _instance = GeofenceManager._internal();
  factory GeofenceManager() => _instance;
  GeofenceManager._internal();

  final FlutterLocalNotificationsPlugin _notificationsPlugin = FlutterLocalNotificationsPlugin();

  // Cache keys
  static const String _sitesKey = 'cached_mobile_sites';
  static const String _attendanceStateKey = 'cached_attendance_state';
  static const String _lastNotifiedStateKey = 'last_notified_state'; // 'entered' or 'exited' or 'none'

  /// Initialize local notification services
  Future<void> initNotifications() async {
    const AndroidInitializationSettings initializationSettingsAndroid =
        AndroidInitializationSettings('@mipmap/ic_launcher');
    
    const DarwinInitializationSettings initializationSettingsIOS = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );

    const InitializationSettings initializationSettings = InitializationSettings(
      android: initializationSettingsAndroid,
      iOS: initializationSettingsIOS,
    );

    await _notificationsPlugin.initialize(
      initializationSettings,
      onDidReceiveNotificationResponse: (NotificationResponse response) {
        // Handle notification click - open app
      },
    );
  }

  /// Show a premium, custom local notification to the user
  Future<void> showNotification(String title, String body) async {
    const AndroidNotificationDetails androidDetails = AndroidNotificationDetails(
      'hr_geofencing_channel',
      'تنبيهات الموقع الجغرافي',
      channelDescription: 'تنبيه الموظفين بتسجيل الحضور والانصراف تلقائياً عند تغيير موقعهم الجغرافي',
      importance: Importance.max,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
    );

    const DarwinNotificationDetails iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const NotificationDetails details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );

    await _notificationsPlugin.show(
      Random().nextInt(100000), // Unique ID
      title,
      body,
      details,
    );
  }

  /// Save employee sites data received from the JavaScript Bridge
  Future<void> saveSites(String sitesJson) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sitesKey, sitesJson);
    print("📱 GeofenceManager: Sites updated in local storage.");
    
    // Run an immediate geofence check
    await checkGeofences();
  }

  /// Save employee current attendance state ('in' or 'out') received from JS Bridge
  Future<void> updateAttendanceState(String state) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setString(_attendanceStateKey, state);
    print("📱 GeofenceManager: Attendance state updated to '$state'.");
    
    // Clear notification state on check-in/out to allow fresh triggers
    await prefs.setString(_lastNotifiedStateKey, 'none');
  }

  /// Process background geofence check based on current position and cached state
  Future<void> checkGeofences() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? sitesJson = prefs.getString(_sitesKey);
    final String attendanceState = prefs.getString(_attendanceStateKey) ?? 'out';
    final String lastNotifiedState = prefs.getString(_lastNotifiedStateKey) ?? 'none';

    if (sitesJson == null || sitesJson.isEmpty) {
      print("📱 GeofenceManager: No geofence sites cached yet.");
      return;
    }

    try {
      // Get current location
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;

      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) return;
      }
      
      if (permission == LocationPermission.deniedForever) return;

      final Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.medium,
        timeLimit: const Duration(seconds: 5),
      );

      final List<dynamic> sites = jsonDecode(sitesJson);
      bool isNearAnySite = false;
      String nearSiteName = "";

      for (var site in sites) {
        final double lat = site['latitude'];
        final double lng = site['longitude'];
        final double radius = (site['radius'] as num).toDouble();
        final String name = site['name'];

        final double distance = Geolocator.distanceBetween(
          position.latitude,
          position.longitude,
          lat,
          lng,
        );

        if (distance <= radius) {
          isNearAnySite = true;
          nearSiteName = name;
          break;
        }
      }

      print("📱 GeofenceManager: Distance check finished. Near site: $isNearAnySite, State: $attendanceState, Last alert: $lastNotifiedState");

      // 1. Employee is close to a work site, but is currently checked OUT
      if (isNearAnySite && attendanceState == 'out') {
        if (lastNotifiedState != 'entered') {
          await showNotification(
            "⏰ تذكير تسجيل الحضور",
            "أهلاً بك! لقد وصلت إلى مقر العمل ($nearSiteName). لا تنسَ تسجيل حضورك الآن.",
          );
          await prefs.setString(_lastNotifiedStateKey, 'entered');
        }
      } 
      // 2. Employee is away from ALL work sites, but is currently checked IN
      else if (!isNearAnySite && attendanceState == 'in') {
        if (lastNotifiedState != 'exited') {
          await showNotification(
            "📍 تذكير تسجيل الانصراف",
            "لقد ابتعدت عن موقع العمل. لا تنسَ تسجيل انصرافك لضمان توثيق ساعات عملك.",
          );
          await prefs.setString(_lastNotifiedStateKey, 'exited');
        }
      }
      // 3. Reset states if user enters/exits cleanly
      else if (isNearAnySite && attendanceState == 'in') {
        // Clear exited flag since they are inside and checked in
        if (lastNotifiedState == 'exited') {
          await prefs.setString(_lastNotifiedStateKey, 'none');
        }
      } else if (!isNearAnySite && attendanceState == 'out') {
        // Clear entered flag since they are outside and checked out
        if (lastNotifiedState == 'entered') {
          await prefs.setString(_lastNotifiedStateKey, 'none');
        }
      }

    } catch (e) {
      print("📱 GeofenceManager: Error checking geofences: $e");
    }
  }
}
