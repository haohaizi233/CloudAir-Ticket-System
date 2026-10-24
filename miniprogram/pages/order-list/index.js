// pages/order-list/index.js
const db = wx.cloud.database()

Page({
  data: {
    orderList: [],
    allOrders: [],
    loading: true,
    currentUser: null,
    filterStatus: 'all', // all / paid / refunded
    filterCounts: { all: 0, paid: 0, refunded: 0 },
    touchStartX: 0,
    touchStartY: 0,
    swipeIndex: -1,
    searchKeyword: '',
    refundSuccess: false,
    priceStats: { total: 0, paid: 0, refunded: 0 },
    batchMode: false,
    selectedOrders: [],
    orderSortBy: 'default',
    showExportModal: false,
    exportText: '',
    showOrderDetail: false,
    detailOrder: {},
    filterRoute: '',
    filterDateRange: '',
    showFilterPanel: false,
    viewMode: 'card',
    timelineGroups: [],
    searchSuggestions: [],
    showSearchSuggestions: false,
    orderSearchHistory: []
  },

  onShow() {
    const user = wx.getStorageSync('currentUser')
    if (user) {
      this.setData({ currentUser: user })
    }
    // 加载订单搜索历史
    const orderSearchHistory = wx.getStorageSync('orderSearchHistory') || []
    this.setData({ orderSearchHistory })
    this.getMyOrders()
  },

  // 获取我的订单
  getMyOrders(isRefresh = false) {
    if (!isRefresh) {
      wx.showLoading({ title: '加载订单...' })
    }

    const MAX_LIMIT = 20
    db.collection('orders')
      .count()
      .then(countRes => {
        const total = countRes.total
        const batchTimes = Math.ceil(total / MAX_LIMIT)
        if (batchTimes === 0) {
          this.setData({ orderList: [], loading: false })
          if (isRefresh) {
            wx.stopPullDownRefresh()
            wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
          } else {
            wx.hideLoading()
          }
          return
        }
        const allResults = []
        for (let i = 0; i < batchTimes; i++) {
          allResults.push(
            db.collection('orders')
              .orderBy('create_time', 'desc')
              .skip(i * MAX_LIMIT)
              .limit(MAX_LIMIT)
              .get()
          )
        }
        return Promise.all(allResults)
      })
      .then(results => {
        if (!results) return
        let allData = []
        results.forEach(res => { allData = allData.concat(res.data) })
        // 格式化下单时间
        allData.forEach(item => {
          if (item.create_time) {
            const d = new Date(item.create_time)
            item.create_time_str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          }
        })
        this.setData({
          allOrders: allData,
          loading: false
        })
        this.applyFilter()
        if (isRefresh) {
          wx.stopPullDownRefresh()
          wx.showToast({ title: '已刷新', icon: 'success', duration: 1000 })
        } else {
          wx.hideLoading()
        }
      })
      .catch(err => {
        console.error('加载失败', err)
        if (isRefresh) {
          wx.stopPullDownRefresh()
          wx.showToast({ title: '刷新失败', icon: 'none' })
        } else {
          wx.hideLoading()
        }
      })
  },

  onPullDownRefresh() {
    // 重置滑动状态
    this.setData({ swipeIndex: -1 })
    this.getMyOrders(true)
  },

  // 筛选状态切换
  onFilterChange(e) {
    const filterStatus = e.currentTarget.dataset.status
    this.setData({ filterStatus })
    this.applyFilter()
  },

  // 应用筛选
  applyFilter() {
    const { allOrders, filterStatus, searchKeyword, filterRoute, filterDateRange } = this.data
    let filtered = allOrders
    if (filterStatus === 'paid') {
      filtered = allOrders.filter(item => item.status === 1)
    } else if (filterStatus === 'refunded') {
      filtered = allOrders.filter(item => item.status === 2)
    }
    // 搜索关键词过滤
    if (searchKeyword) {
      const kw = searchKeyword.toLowerCase()
      filtered = filtered.filter(item =>
        (item.flight_info && item.flight_info.flight_no && item.flight_info.flight_no.toLowerCase().includes(kw)) ||
        (item.flight_info && item.flight_info.origin && item.flight_info.origin.includes(kw)) ||
        (item.flight_info && item.flight_info.dest && item.flight_info.dest.includes(kw)) ||
        (item.seat_no && item.seat_no.toLowerCase().includes(kw)) ||
        (item._id && item._id.includes(kw))
      )
    }
    // 航线筛选
    if (filterRoute) {
      filtered = filtered.filter(item => {
        const fi = item.flight_info || {}
        const route = `${fi.origin || ''}-${fi.dest || ''}`
        return route.includes(filterRoute)
      })
    }
    // 日期范围筛选
    if (filterDateRange) {
      const now = new Date()
      filtered = filtered.filter(item => {
        const od = new Date(item.create_time)
        if (isNaN(od.getTime())) return true
        switch (filterDateRange) {
          case 'week': return (now - od) < 7 * 86400000
          case 'month': return (now - od) < 30 * 86400000
          case 'quarter': return (now - od) < 90 * 86400000
          default: return true
        }
      })
    }
    // 计算各状态数量
    const filterCounts = {
      all: allOrders.length,
      paid: allOrders.filter(item => item.status === 1).length,
      refunded: allOrders.filter(item => item.status === 2).length
    }
    // 计算金额统计
    const priceStats = {
      total: allOrders.reduce((sum, item) => sum + (item.price || 0), 0),
      paid: allOrders.filter(item => item.status === 1).reduce((sum, item) => sum + (item.price || 0), 0),
      refunded: allOrders.filter(item => item.status === 2).reduce((sum, item) => sum + (item.price || 0), 0)
    }
    this.setData({ orderList: filtered, filterCounts, priceStats })
    // 构建时间线数据
    this.buildTimelineGroups(filtered)
  },

  // 搜索输入（防抖 + 搜索建议）
  onSearchInput(e) {
    const value = e.detail.value
    this.setData({ searchKeyword: value })
    // 生成搜索建议
    if (value.length > 0) {
      this.generateSearchSuggestions(value)
      this.setData({ showSearchSuggestions: true })
    } else {
      this.setData({ searchSuggestions: [], showSearchSuggestions: false })
    }
    clearTimeout(this._searchTimer)
    this._searchTimer = setTimeout(() => {
      this.applyFilter()
    }, 300)
  },

  // 生成搜索建议
  generateSearchSuggestions(keyword) {
    const kw = keyword.toLowerCase()
    const { allOrders } = this.data
    const suggestions = []
    const flightNos = new Set()
    const cities = new Set()
    allOrders.forEach(order => {
      const fi = order.flight_info || {}
      if (fi.flight_no && fi.flight_no.toLowerCase().includes(kw) && !flightNos.has(fi.flight_no)) {
        flightNos.add(fi.flight_no)
        suggestions.push({ type: 'flight', text: fi.flight_no, desc: `${fi.origin}→${fi.dest}` })
      }
      if (fi.origin && fi.origin.includes(kw) && !cities.has(fi.origin)) {
        cities.add(fi.origin)
        suggestions.push({ type: 'city', text: fi.origin, desc: '出发城市' })
      }
      if (fi.dest && fi.dest.includes(kw) && !cities.has(fi.dest)) {
        cities.add(fi.dest)
        suggestions.push({ type: 'city', text: fi.dest, desc: '到达城市' })
      }
    })
    this.setData({ searchSuggestions: suggestions.slice(0, 6) })
  },

  // 点击搜索建议
  onTapSearchSuggestion(e) {
    const suggestion = e.currentTarget.dataset.suggestion
    this.setData({ searchKeyword: suggestion.text, showSearchSuggestions: false, searchSuggestions: [] })
    this.saveOrderSearchHistory(suggestion.text)
    this.applyFilter()
  },

  // 搜索失焦
  onSearchBlur() {
    setTimeout(() => {
      this.setData({ showSearchSuggestions: false })
      // 保存搜索历史
      if (this.data.searchKeyword.trim()) {
        this.saveOrderSearchHistory(this.data.searchKeyword.trim())
      }
    }, 200)
  },

  // 保存订单搜索历史
  saveOrderSearchHistory(keyword) {
    let history = wx.getStorageSync('orderSearchHistory') || []
    history = history.filter(h => h !== keyword)
    history.unshift(keyword)
    if (history.length > 10) history = history.slice(0, 10)
    wx.setStorageSync('orderSearchHistory', history)
    this.setData({ orderSearchHistory: history })
  },

  // 点击搜索历史标签
  onTapOrderSearchHistory(e) {
    const keyword = e.currentTarget.dataset.keyword
    this.setData({ searchKeyword: keyword })
    this.applyFilter()
  },

  // 清空搜索历史
  onClearOrderSearchHistory() {
    wx.removeStorageSync('orderSearchHistory')
    this.setData({ orderSearchHistory: [] })
  },

  // 清空搜索
  onClearSearch() {
    this.setData({ searchKeyword: '' })
    this.applyFilter()
  },

  // 批量操作模式
  onToggleBatchMode() {
    this.setData({ batchMode: !this.data.batchMode, selectedOrders: [] })
  },

  onToggleSelectOrder(e) {
    const orderId = e.currentTarget.dataset.order._id
    const orderStatus = e.currentTarget.dataset.order.status
    if (orderStatus === 2) {
      wx.showToast({ title: '已退票订单不可选', icon: 'none' })
      return
    }
    let selectedOrders = [...this.data.selectedOrders]
    const idx = selectedOrders.indexOf(orderId)
    if (idx >= 0) {
      selectedOrders.splice(idx, 1)
    } else {
      selectedOrders.push(orderId)
    }
    this.setData({ selectedOrders })
    this.updateOrderSelectionFlags()
  },

  // 更新订单选中标记
  updateOrderSelectionFlags() {
    const { selectedOrders, orderList } = this.data
    const updated = orderList.map(item => ({
      ...item,
      isSelected: selectedOrders.indexOf(item._id) >= 0
    }))
    this.setData({ orderList: updated })
  },

  onBatchRefund() {
    const { selectedOrders } = this.data
    if (selectedOrders.length === 0) {
      wx.showToast({ title: '请选择订单', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认批量退票',
      content: `确定要退掉 ${selectedOrders.length} 个订单吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '退票中...' })
          const promises = selectedOrders.map(id => {
            return db.collection('orders').doc(id).update({ data: { status: 2 } })
          })
          Promise.all(promises).then(() => {
            wx.hideLoading()
            wx.showToast({ title: '批量退票成功', icon: 'success' })
            this.setData({ batchMode: false, selectedOrders: [] })
            this.loadOrders()
          }).catch(err => {
            wx.hideLoading()
            console.error('批量退票失败', err)
            wx.showToast({ title: '部分退票失败', icon: 'none' })
          })
        }
      }
    })
  },

  // 订单排序
  onOrderSort(e) {
    const orderSortBy = e.currentTarget.dataset.sort
    this.setData({ orderSortBy })
    this.applySort()
  },

  applySort() {
    let list = [...this.data.allOrders]
    switch (this.data.orderSortBy) {
      case 'priceAsc':
        list.sort((a, b) => (a.price || 0) - (b.price || 0))
        break
      case 'priceDesc':
        list.sort((a, b) => (b.price || 0) - (a.price || 0))
        break
      case 'timeDesc':
        list.sort((a, b) => {
          const ta = a.create_time ? new Date(a.create_time).getTime() : 0
          const tb = b.create_time ? new Date(b.create_time).getTime() : 0
          return tb - ta
        })
        break
      default:
        break
    }
    this.setData({ orderList: list })
  },

  // 退票逻辑
  onRefund(e) {
    const order = e.currentTarget.dataset.order
    
    // 严谨性：二次确认
    wx.showModal({
      title: '退票确认',
      content: '确定要退掉这张票吗？座位将释放给他人。',
      success: (res) => {
        if (res.confirm) {
          this.executeRefund(order)
        }
      }
    })
  },

  // 执行退票事务
  executeRefund(order) {
    wx.showLoading({ title: '正在退票...' })

    // 第一步：将订单状态改为 2 (已退票)，条件更新确保只退已支付的订单
    db.collection('orders').where({
      _id: order._id,
      status: 1
    }).update({
      data: {
        status: 2 
      }
    }).then(res => {
      if (res.stats.updated === 0) {
        throw new Error('订单状态异常，无法退票')
      }
      // 第二步：释放座位库存 (将 seats 表对应记录 status 改回 0)
      return db.collection('seats').doc(order.seat_id).update({
        data: {
          status: 0 // 0 代表空闲
        }
      })
    }).then(() => {
      wx.hideLoading()
      // 退票成功动画
      this.setData({ refundSuccess: true })
      wx.showToast({ title: '退票成功', icon: 'success' })
      
      // 重置滑动状态
      this.setData({ swipeIndex: -1 })
      // 延迟刷新列表，让用户看到动画
      setTimeout(() => {
        this.setData({ refundSuccess: false })
        this.getMyOrders()
      }, 800)
    }).catch(err => {
      console.error('退票失败', err)
      this.setData({ submitting: false })
      wx.hideLoading()
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  },

  onShowCode(e) {
    const order = e.currentTarget.dataset.order
    // 转成字符串传递
    const orderStr = encodeURIComponent(JSON.stringify(order))
    
    wx.navigateTo({
      url: `/pages/boarding-pass/index?order=${orderStr}`
    })
  },

  // 点击卡片显示详情弹窗
  onCardTap(e) {
    const order = e.currentTarget.dataset.order
    this.setData({ showOrderDetail: true, detailOrder: order })
  },

  // 关闭订单详情弹窗
  onCloseOrderDetail() {
    this.setData({ showOrderDetail: false })
  },

  // 从详情弹窗跳转登机牌
  onShowCodeFromDetail() {
    const order = this.data.detailOrder
    this.setData({ showOrderDetail: false })
    const orderStr = encodeURIComponent(JSON.stringify(order))
    wx.navigateTo({
      url: `/pages/boarding-pass/index?order=${orderStr}`
    })
  },

  // 分享给好友
  onShareAppMessage() {
    return {
      title: '云端航空 - 我的订单',
      path: '/pages/order-list/index'
    }
  },

  // 跳转首页
  onGoHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  // 导出订单
  onExportOrders() {
    const { orderList, filterStatus } = this.data
    if (orderList.length === 0) {
      wx.showToast({ title: '暂无订单可导出', icon: 'none' })
      return
    }
    const statusText = { all: '全部', paid: '已支付', refunded: '已退票' }
    let text = `云端航空 - 订单导出\n`
    text += `导出时间：${new Date().toLocaleString('zh-CN')}\n`
    text += `筛选状态：${statusText[filterStatus] || '全部'}\n`
    text += `订单数量：${orderList.length}\n`
    text += `总金额：¥${orderList.reduce((s, o) => s + (o.price || 0), 0)}\n`
    text += '──────────────────\n'
    orderList.forEach((order, i) => {
      const fi = order.flight_info || {}
      text += `\n【订单${i + 1}】\n`
      text += `订单号：${order._id}\n`
      text += `航班：${fi.flight_no || '-'}\n`
      text += `航线：${fi.origin || '-'} → ${fi.dest || '-'}\n`
      text += `日期：${fi.dept_time || '-'}\n`
      text += `座位：${order.seat_no || '-'}\n`
      text += `金额：¥${order.price || 0}\n`
      text += `状态：${order.status === 1 ? '已支付' : '已退票'}\n`
      text += `下单时间：${order.create_time_str || '-'}\n`
    })
    this.setData({ showExportModal: true, exportText: text })
  },

  // 复制导出文本
  onCopyExport() {
    wx.setClipboardData({
      data: this.data.exportText,
      success: () => {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' })
      }
    })
  },

  // 关闭导出弹窗
  onCloseExport() {
    this.setData({ showExportModal: false })
  },

  // 切换筛选面板
  onToggleFilterPanel() {
    this.setData({ showFilterPanel: !this.data.showFilterPanel })
  },

  // 航线筛选输入
  onFilterRouteInput(e) {
    this.setData({ filterRoute: e.detail.value })
    this.applyFilter()
  },

  // 日期范围筛选
  onFilterDateRange(e) {
    const range = e.currentTarget.dataset.range
    this.setData({ filterDateRange: this.data.filterDateRange === range ? '' : range })
    this.applyFilter()
  },

  // 重置筛选
  onResetFilters() {
    this.setData({ filterRoute: '', filterDateRange: '' })
    this.applyFilter()
  },

  // 滑动删除已退票订单
  onDeleteOrder(e) {
    const order = e.currentTarget.dataset.order
    wx.showModal({
      title: '删除订单',
      content: '确定要删除这条退票记录吗？删除后不可恢复。',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) {
          this.deleteOrder(order)
        }
      }
    })
  },

  // 复制订单号
  onCopyOrderId(e) {
    const id = e.currentTarget.dataset.id
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({ title: '订单号已复制', icon: 'success' })
      }
    })
  },

  // 长按删除已退票订单
  onLongPress(e) {
    const order = e.currentTarget.dataset.order
    if (order.status !== 2) {
      wx.showToast({ title: '只能删除已退票订单', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除订单',
      content: '确定要删除这条退票记录吗？删除后不可恢复。',
      confirmColor: '#e34d59',
      success: (res) => {
        if (res.confirm) {
          this.deleteOrder(order)
        }
      }
    })
  },

  // 执行删除订单
  deleteOrder(order) {
    wx.showLoading({ title: '删除中...' })
    db.collection('orders').doc(order._id).remove().then(() => {
      wx.hideLoading()
      wx.showToast({ title: '已删除', icon: 'success' })
      this.getMyOrders()
    }).catch(err => {
      console.error('删除失败', err)
      wx.hideLoading()
      wx.showToast({ title: '删除失败', icon: 'none' })
    })
  },

  // 点击空白区域关闭滑动
  onCloseSwipe() {
    if (this.data.swipeIndex >= 0) {
      const key = `orderList[${this.data.swipeIndex}].translateX`
      this.setData({ [key]: 0, swipeIndex: -1 })
    }
  },

  // 滑动手势
  onTouchStart(e) {
    this.setData({ touchStartX: e.touches[0].clientX, touchStartY: e.touches[0].clientY })
  },

  onTouchMove(e) {
    const index = e.currentTarget.dataset.index
    const deltaX = e.touches[0].clientX - this.data.touchStartX
    const deltaY = e.touches[0].clientY - this.data.touchStartY
    // 如果纵向滑动大于横向，不处理
    if (Math.abs(deltaY) > Math.abs(deltaX)) return
    const key = `orderList[${index}].translateX`
    // 限制左滑范围 0 ~ -80
    const x = Math.min(0, Math.max(-80, deltaX))
    this.setData({ [key]: x })
  },

  onTouchEnd(e) {
    const index = e.currentTarget.dataset.index
    const item = this.data.orderList[index]
    const key = `orderList[${index}].translateX`
    // 滑动超过一半则展开，否则收回
    if (item.translateX < -40) {
      this.setData({ [key]: -80, swipeIndex: index })
    } else {
      this.setData({ [key]: 0, swipeIndex: -1 })
    }
  },

  // 切换视图模式
  onToggleViewMode() {
    const viewMode = this.data.viewMode === 'card' ? 'timeline' : 'card'
    this.setData({ viewMode })
  },

  // 构建时间线分组数据
  buildTimelineGroups(orders) {
    if (!orders || orders.length === 0) {
      this.setData({ timelineGroups: [] })
      return
    }
    const groups = {}
    orders.forEach(order => {
      const fi = order.flight_info || {}
      const dateStr = fi.dept_time || (order.create_time_str ? order.create_time_str.split(' ')[0] : '未知日期')
      if (!groups[dateStr]) {
        groups[dateStr] = { date: dateStr, orders: [] }
      }
      groups[dateStr].orders.push({
        _id: order._id,
        flightNo: fi.flight_no || '-',
        origin: fi.origin || '-',
        dest: fi.dest || '-',
        seatNo: order.seat_no || '-',
        price: order.price || 0,
        status: order.status,
        statusText: order.status === 1 ? '待出行' : '已退票',
        statusClass: order.status === 1 ? 'tl-paid' : 'tl-refunded',
        createTime: order.create_time_str || '-'
      })
    })
    // 按日期降序排列
    const sortedGroups = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date))
    this.setData({ timelineGroups: sortedGroups })
  },

  // 时间线节点点击
  onTimelineOrderTap(e) {
    const orderId = e.currentTarget.dataset.id
    const order = this.data.orderList.find(o => o._id === orderId)
    if (order) {
      this.setData({ showOrderDetail: true, detailOrder: order })
    }
  }
})